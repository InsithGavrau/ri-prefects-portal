export function drawBackground() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (document.querySelector(".canvas-bg")) return;

  const canvas = document.createElement("canvas");
  canvas.className = "canvas-bg";
  document.body.prepend(canvas);

  const context = canvas.getContext("2d");
  let dots = [];

  const resize = () => {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    const maxDots = innerWidth < 760 ? 18 : 36;
    dots = Array.from({ length: Math.min(maxDots, Math.ceil(innerWidth / 34)) }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.8 + 0.4,
      v: Math.random() * 0.09 + 0.02,
      color: ["#6A362A33", "#C9A64644", "#FEFED633", "#FFFFFF40"][Math.floor(Math.random() * 4)],
    }));
  };

  resize();
  addEventListener("resize", resize);

  const frame = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    dots.forEach((dot) => {
      dot.y -= dot.v;
      if (dot.y < 0) dot.y = canvas.height;
      context.beginPath();
      context.fillStyle = dot.color;
      context.arc(dot.x, dot.y, dot.r, 0, 7);
      context.fill();
    });
    requestAnimationFrame(frame);
  };

  frame();
}
