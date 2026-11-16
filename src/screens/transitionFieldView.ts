import { flushSync } from "react-dom";

let activeTransition: ViewTransition | undefined;
let updatePending = false;

export default function transitionFieldView(update: () => void, scene: "travel" | "analysis" | "map" | "battle" = "travel") {
  if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }

  if (updatePending) return;
  activeTransition?.skipTransition();
  const root = document.documentElement;
  root.setAttribute("data-field-transition", scene);
  updatePending = true;
  const transition = document.startViewTransition(() => {
    updatePending = false;
    flushSync(update);
  });
  activeTransition = transition;
  const cleanup = () => {
    if (activeTransition !== transition) return;
    activeTransition = undefined;
    root.removeAttribute("data-field-transition");
  };
  void transition.finished.then(cleanup, cleanup);
}
