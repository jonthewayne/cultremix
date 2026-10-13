import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

// For hackathon judges (accounts made in Admin, Judges): the loop in four steps, under the studio's
// title until they dismiss it. Remembered in this browser only.
const DISMISSED = "cr-judge-welcome-dismissed";

export function JudgeWelcome() {
  // Hidden until mounted, so the server render and a dismissed browser agree.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(window.localStorage.getItem(DISMISSED) !== "1");
  }, []);
  if (!shown) return null;
  const dismiss = () => {
    window.localStorage.setItem(DISMISSED, "1");
    setShown(false);
  };
  return (
    <section aria-labelledby="judge-welcome" className="rounded-2xl border-2 border-black p-4 md:p-5">
      <h2 id="judge-welcome" className="text-sm font-bold uppercase tracking-wider">
        Welcome, judge
      </h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
        <li>Make something here: add an image or say what you want, then Generate. Four designs arrive together.</li>
        <li>Publish your favorite. It gets a CR number, a shop page, and a photo of someone wearing it.</li>
        <li>
          Remix someone else's design from the{" "}
          <Link to="/" className="font-semibold underline underline-offset-4">
            feed
          </Link>
          : change its words or characters, and the remix joins its family as the next number, crediting where it came from.
        </li>
        <li>
          Follow the lineage on any remix's page, and see what CultRemix records on Monad at{" "}
          <Link to="/onchain" className="font-semibold underline underline-offset-4">
            /onchain
          </Link>
          .
        </li>
      </ol>
      <button type="button" onClick={dismiss} className="mt-3 h-10 text-sm font-bold underline underline-offset-4">
        Got it
      </button>
    </section>
  );
}
