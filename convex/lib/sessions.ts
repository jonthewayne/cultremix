// A studio session's name: the member's own title, else "Remix of CR …" for a remix, else the
// session's first request, shortened.
export function sessionName(args: { title?: string; remixCr?: string; firstInstruction?: string }) {
  const title = args.title?.trim();
  if (title) return title;
  if (args.remixCr) return `Remix of CR ${args.remixCr}`;
  const first = args.firstInstruction?.replace(/\s+/gu, " ").trim();
  if (!first) return "Untitled session";
  if (first.length <= 60) return first;
  const cut = first.slice(0, 58);
  const space = cut.lastIndexOf(" ");
  return `${(space > 30 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export const SESSION_TITLE_MAX = 80;
