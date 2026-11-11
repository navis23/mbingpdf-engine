/** What every page needs: buttons that copy, and a copy button on each block of code. */

async function copy(button: HTMLElement, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  const label = button.querySelector("span");
  const before = label?.textContent ?? "";
  button.dataset.done = "";
  if (label) label.textContent = "Copied";
  setTimeout(() => {
    delete button.dataset.done;
    if (label) label.textContent = before;
  }, 1600);
}

for (const block of document.querySelectorAll<HTMLElement>(".prose .code")) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy";
  button.setAttribute("aria-label", "Copy the code");
  button.innerHTML = "<span>Copy</span>";
  button.addEventListener("click", () => {
    void copy(button, block.querySelector("pre")?.textContent ?? "");
  });
  block.append(button);
}

document.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLElement>("[data-copy]");
  if (!button) return;
  // An install command inside a link must not follow the link.
  event.preventDefault();
  void copy(button, button.dataset.copy ?? "");
});

// On a phone the list of documentation pages starts closed.
const pages = document.querySelector<HTMLDetailsElement>(".docs-nav details");
if (pages && window.matchMedia("(max-width: 760px)").matches) pages.open = false;
