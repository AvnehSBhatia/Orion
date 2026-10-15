// The live pitch, one step per beat. Tab types the step's prompt; Enter sends it, and the app moves to the right
// window on its own. The next Tab moves on to the next step. Right/Left still step through by hand.
// Captions are written for the judges: plain English, one line, nothing they need to already know.

export type DemoView = "hero" | "home" | "map" | "context";

export type DemoStep = {
  /** The window the step shows once its prompt is sent. */
  view: Exclude<DemoView, "hero">;
  title: string;
  caption: string;
  /** What Tab types. */
  prompts: string[];
  /** A dashboard card to bring into view once the prompt is sent and whenever the dashboard reshapes. */
  scrollTo?: "constellation";
  /** After the answer lands, open the project it is about. */
  openFocus?: boolean;
};

export const DEMO_STEPS: DemoStep[] = [
  {
    view: "home",
    title: "A dashboard that builds itself",
    caption: "Say who you are and what you need. Orion rebuilds the page around it, live.",
    prompts: ["I run sales. Show me what we can sell this week and what's at risk."],
  },
  {
    view: "home",
    title: "Code changes, in plain English",
    caption: "The latest commits from the team's repos, explained for someone who doesn't read code.",
    prompts: ["Show the latest pull requests and explain what changed for our head of marketing."],
  },
  {
    view: "home",
    title: "Every piece of work, placed by meaning",
    caption: "Each dot is a page someone read or code someone wrote. Similar work clusters together.",
    prompts: ["Show me the constellation. What topics is the team focused on?"],
    scrollTo: "constellation",
  },
  {
    view: "home",
    title: "One project, and what to do next",
    caption: "Orion opens the project: its status, who owns it, what changed, and the next step.",
    prompts: ["What's going on with saved card checkout, and what do we need to do next?"],
    openFocus: true,
  },
  {
    view: "context",
    title: "How the work connects",
    caption: "What waits on what, who feeds each project, and the topics it all falls into.",
    prompts: ["How does checkout connect to the rest of the company?"],
  },
];
