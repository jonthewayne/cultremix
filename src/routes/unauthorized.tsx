import { Link, createFileRoute } from "@tanstack/react-router";
import { PublicFrame } from "~/components/app/public-frame";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

export const Route = createFileRoute("/unauthorized")({
  component: UnauthorizedPage,
});

function UnauthorizedPage() {
  return (
    <PublicFrame>
      <Card className="w-full text-center">
        <CardHeader>
          <CardTitle>Unauthorized</CardTitle>
          <CardDescription>Your account does not have access to that page.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/studio">Back to the studio</Link>
          </Button>
        </CardContent>
      </Card>
    </PublicFrame>
  );
}
