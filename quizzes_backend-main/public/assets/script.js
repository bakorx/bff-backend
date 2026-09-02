function animateElegantShapes() {
  const shapes = document.querySelectorAll(".elegant-shape");
  shapes.forEach((shape) => {
    const delay = parseFloat(shape.dataset.delay);
    const width = parseFloat(shape.dataset.width);
    const height = parseFloat(shape.dataset.height);
    const rotate = parseFloat(shape.dataset.rotate);
    const gradient = shape.dataset.gradient;

    shape.style.width = `${width}px`;
    shape.style.height = `${height}px`;

    const inner = document.createElement("div");
    inner.className = "elegant-shape-inner";
    inner.style.width = `${width}px`;
    inner.style.height = `${height}px`;

    const content = document.createElement("div");
    content.className = "elegant-shape-content";
    content.style.background = `linear-gradient(to right, ${gradient}, transparent)`;

    inner.appendChild(content);
    shape.appendChild(inner);

    setTimeout(() => {
      shape.style.transition =
        "opacity 1.2s, transform 2.4s cubic-bezier(0.23, 0.86, 0.39, 0.96)";
      shape.style.opacity = "1";
      shape.style.transform = `translateY(0) rotate(${rotate}deg)`;
    }, delay * 1000);

    setInterval(() => {
      inner.style.transition = "transform 12s ease-in-out";
      inner.style.transform = "translateY(15px)";
      setTimeout(() => {
        inner.style.transform = "translateY(0)";
      }, 6000);
    }, 12000);
  });
}

function animateContent() {
  const elements = [
    document.querySelector(".badge"),
    document.querySelector("h1"),
    document.querySelector("p"),
    document.querySelector(".cta-buttons"),
  ];

  elements.forEach((el, index) => {
    setTimeout(() => {
      el.style.transition =
        "opacity 1s, transform 1s cubic-bezier(0.25, 0.4, 0.25, 1)";
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    }, 500 + index * 200);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  animateElegantShapes();
  animateContent();
});
