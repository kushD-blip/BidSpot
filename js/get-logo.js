/* js/get-logo.js — client-side logo resolution with graceful fallback chain:
   Clearbit logo -> Google favicon service -> colored initials avatar (no network call). */

export function getLogoUrl(domainOrUrl) {
  const domain = extractDomain(domainOrUrl);
  return {
    domain,
    primary: domain ? `https://logo.clearbit.com/${domain}?size=128` : null,
    fallback: domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : null,
  };
}

function extractDomain(input) {
  if (!input || typeof input !== "string" || input.startsWith("@")) return null; // handle, not a domain
  try {
    const url = input.includes("://") ? input : `https://${input}`;
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Renders a logo <img> into `container`, falling back through the chain above and
 * finally to the initials avatar already computed for the item (logoText/logoBg),
 * so a dead network request never leaves a blank card.
 */
export function renderLogo(container, domainOrUrl, { text, bg } = {}) {
  const { primary, fallback } = getLogoUrl(domainOrUrl);

  if (!primary) {
    renderInitials(container, text, bg);
    return;
  }

  const img = document.createElement("img");
  img.alt = "";
  img.loading = "lazy";
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.objectFit = "contain";
  img.style.borderRadius = "inherit";
  img.style.background = "#fff";

  let attempt = 0;
  img.onerror = () => {
    attempt++;
    if (attempt === 1 && fallback) {
      img.src = fallback;
    } else {
      renderInitials(container, text, bg);
    }
  };
  img.src = primary;
  container.replaceChildren(img);
}

function renderInitials(container, text, bg) {
  container.replaceChildren();
  container.textContent = text || "?";
  if (bg) container.style.background = bg;
}
