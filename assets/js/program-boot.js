// Arms the program app's scroll-reveal system before first paint. Kept in
// its own render-blocking file (see the comment at its <script> tag in
// program.html) so [data-reveal] elements are never painted revealed and
// then hidden — and so the page degrades to fully visible, rather than
// blank, if scripting is unavailable.
document.documentElement.classList.add("pg-js");
