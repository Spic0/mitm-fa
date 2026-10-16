// Arms the scroll-reveal system's initial hidden state. Kept in its own
// render-blocking file (see the comment at its <script> tag in
// private/presentation.html) so [data-reveal] elements are never painted in
// their revealed state and then hidden — and so the deck degrades to fully
// visible, rather than blank, if scripting is unavailable.
document.documentElement.classList.add("pres-js");
