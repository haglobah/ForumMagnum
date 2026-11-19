// <lw-header design="03 · Catalogue"> : the site's bar with a way back to the hub.
customElements.define("lw-header", class extends HTMLElement {
  connectedCallback() {
    const name = this.getAttribute("design") || "";
    this.innerHTML = `<header class="lw-header">
      <span class="logo">LessWrong</span><span class="crumb">The Library</span>
      <span class="spacer"></span>
      <span class="proto">Prototype ${name} · <a href="../../">all designs</a></span>
    </header>`;
  }
});
