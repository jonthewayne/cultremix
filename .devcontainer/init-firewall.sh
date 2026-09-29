#!/bin/bash
set -euo pipefail  # Exit on error, undefined vars, and pipeline failures
IFS=$'\n\t'       # Stricter word splitting

# =============================================================================
# Firewall for Claude Code Docker Container
# =============================================================================
# Usage:
#   ./init-firewall.sh          # Default: open internet, block private networks
#   ./init-firewall.sh --strict # Strict: allowlist only (GitHub, npm, Anthropic, etc.)
# =============================================================================

MODE="${1:-open}"

echo "========================================"
echo "Firewall Mode: $MODE"
echo "========================================"

# 1. Extract Docker DNS info BEFORE any flushing
DOCKER_DNS_RULES=$(iptables-save -t nat | grep "127\.0\.0\.11" || true)

# Flush existing rules
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X

# 2. Selectively restore ONLY internal Docker DNS resolution
if [ -n "$DOCKER_DNS_RULES" ]; then
    echo "Restoring Docker DNS rules..."
    iptables -t nat -N DOCKER_OUTPUT 2>/dev/null || true
    iptables -t nat -N DOCKER_POSTROUTING 2>/dev/null || true
    echo "$DOCKER_DNS_RULES" | xargs -L 1 iptables -t nat
else
    echo "No Docker DNS rules to restore"
fi

# =============================================================================
# Common rules for both modes
# =============================================================================

# Allow localhost
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# Allow DNS
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A INPUT -p udp --sport 53 -j ACCEPT

# Get host IP from default route (for dev server access)
HOST_IP=$(ip route | grep default | cut -d" " -f3)
if [ -z "$HOST_IP" ]; then
    echo "ERROR: Failed to detect host IP"
    exit 1
fi
HOST_NETWORK=$(echo "$HOST_IP" | sed "s/\.[0-9]*$/.0\/24/")
echo "Host network detected as: $HOST_NETWORK"

# Allow Docker host network (for dev server)
iptables -A INPUT -s "$HOST_NETWORK" -j ACCEPT
iptables -A OUTPUT -d "$HOST_NETWORK" -j ACCEPT

# Set default policies to DROP
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# =============================================================================
# Mode-specific rules
# =============================================================================

if [ "$MODE" = "--strict" ]; then
    echo "Applying STRICT mode (allowlist only)..."

    # Allow outbound SSH
    iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT
    iptables -A INPUT -p tcp --sport 22 -m state --state ESTABLISHED -j ACCEPT

    # Create ipset with CIDR support
    ipset destroy allowed-domains 2>/dev/null || true
    ipset create allowed-domains hash:net

    # Fetch GitHub meta information and aggregate + add their IP ranges
    echo "Fetching GitHub IP ranges..."
    gh_ranges=$(curl -s https://api.github.com/meta)
    if [ -z "$gh_ranges" ]; then
        echo "ERROR: Failed to fetch GitHub IP ranges"
        exit 1
    fi

    if ! echo "$gh_ranges" | jq -e '.web and .api and .git' >/dev/null; then
        echo "ERROR: GitHub API response missing required fields"
        exit 1
    fi

    echo "Processing GitHub IPs..."
    while read -r cidr; do
        if [[ ! "$cidr" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2}$ ]]; then
            echo "ERROR: Invalid CIDR range from GitHub meta: $cidr"
            exit 1
        fi
        echo "Adding GitHub range $cidr"
        ipset add allowed-domains "$cidr"
    done < <(echo "$gh_ranges" | jq -r '(.web + .api + .git)[]' | aggregate -q)

    # Resolve and add other allowed domains
    for domain in \
        "registry.npmjs.org" \
        "api.anthropic.com" \
        "sentry.io" \
        "statsig.anthropic.com" \
        "statsig.com" \
        "marketplace.visualstudio.com" \
        "vscode.blob.core.windows.net" \
        "update.code.visualstudio.com"; do
        echo "Resolving $domain..."
        ips=$(dig +noall +answer A "$domain" | awk '$4 == "A" {print $5}')
        if [ -z "$ips" ]; then
            echo "ERROR: Failed to resolve $domain"
            exit 1
        fi

        while read -r ip; do
            if [[ ! "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
                echo "ERROR: Invalid IP from DNS for $domain: $ip"
                exit 1
            fi
            echo "Adding $ip for $domain"
            ipset add allowed-domains "$ip"
        done < <(echo "$ips")
    done

    # Allow only approved domains
    iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT
    iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

    echo "========================================"
    echo "STRICT mode active"
    echo "  ✓ GitHub, npm, Anthropic, VS Code allowed"
    echo "  ✓ Docker host network allowed"
    echo "  ✗ All other internet blocked"
    echo "========================================"

    # Verify strict mode
    if curl --connect-timeout 5 https://example.com >/dev/null 2>&1; then
        echo "ERROR: Firewall verification failed - was able to reach example.com"
        exit 1
    else
        echo "✓ Verified: example.com blocked"
    fi

    if ! curl --connect-timeout 5 https://api.github.com/zen >/dev/null 2>&1; then
        echo "ERROR: Firewall verification failed - unable to reach api.github.com"
        exit 1
    else
        echo "✓ Verified: api.github.com accessible"
    fi

else
    echo "Applying OPEN mode (public internet allowed)..."

    # Block private networks (except Docker host, already allowed above)
    iptables -A OUTPUT -d 10.0.0.0/8 -j REJECT --reject-with icmp-admin-prohibited
    iptables -A OUTPUT -d 172.16.0.0/12 -j REJECT --reject-with icmp-admin-prohibited
    iptables -A OUTPUT -d 192.168.0.0/16 -j REJECT --reject-with icmp-admin-prohibited
    iptables -A OUTPUT -d 169.254.0.0/16 -j REJECT --reject-with icmp-admin-prohibited

    # Allow HTTP/HTTPS
    iptables -A OUTPUT -p tcp --dport 80 -j ACCEPT
    iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT

    # Allow Git protocol
    iptables -A OUTPUT -p tcp --dport 9418 -j ACCEPT

    # Allow SSH (for git+ssh)
    iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT

    # Block everything else
    iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

    echo "========================================"
    echo "OPEN mode active"
    echo "  ✓ Public internet (HTTP/HTTPS) allowed"
    echo "  ✓ Docker host network allowed (dev server)"
    echo "  ✓ Git, SSH allowed"
    echo "  ✗ Private networks blocked"
    echo "========================================"

    # Verify open mode
    if ! curl --connect-timeout 5 -s https://example.com >/dev/null 2>&1; then
        echo "WARNING: Cannot reach example.com"
    else
        echo "✓ Verified: public internet accessible"
    fi
fi

echo "Firewall ready!"
