/* macOS-style counter — vanilla JavaScript, zero dependencies */
(function () {
  "use strict";

  var countOutput = document.getElementById("count");
  var decBtn = document.getElementById("decrement");
  var resetBtn = document.getElementById("reset");
  var incBtn = document.getElementById("increment");

  var count = 0;

  function render() {
    countOutput.textContent = String(count);
  }

  function increment() {
    count += 1;
    render();
  }

  function decrement() {
    count -= 1;
    render();
  }

  function reset() {
    count = 0;
    render();
  }

  incBtn.addEventListener("click", increment);
  decBtn.addEventListener("click", decrement);
  resetBtn.addEventListener("click", reset);

  document.addEventListener("keydown", function (event) {
    // Never hijack shortcuts when a modifier is held.
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        increment();
        break;
      case "ArrowDown":
        event.preventDefault();
        decrement();
        break;
      case "r":
      case "R":
        event.preventDefault();
        reset();
        break;
      default:
        break;
    }
  });

  render();
})();
