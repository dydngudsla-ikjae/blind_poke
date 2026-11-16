import { useEffect, useState } from "react";

export default function useFieldMotion() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!navigator.gpu || typeof window.matchMedia !== "function") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setEnabled(!reduced.matches && !document.hidden);
    update();
    reduced.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      reduced.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return enabled;
}
