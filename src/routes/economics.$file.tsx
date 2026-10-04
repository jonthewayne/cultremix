import { createFileRoute } from "@tanstack/react-router";
import { economicsConfigResponse } from "~/lib/economicsRoute";

// /economics/v1.json: the published economics config, byte for byte what its SHA-256 covers.
export const Route = createFileRoute("/economics/$file")({
  server: {
    handlers: {
      GET: ({ params }: { params: { file: string } }) => economicsConfigResponse(params.file),
    },
  },
});
