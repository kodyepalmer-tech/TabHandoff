const steps = document.querySelectorAll(".step");
if (steps.length && "IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.25 },
  );
  for (const step of steps) io.observe(step);
} else {
  for (const step of steps) step.classList.add("is-in");
}
