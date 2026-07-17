/* Floating label state — JS-class approach, reliable across all browsers */
(function () {
    function markFilled(inp) {
        var f = inp.closest('.co-field');
        if (!f || inp.tagName === 'SELECT') return;
        f.classList.toggle('co-filled', inp.value.length > 0);
    }
    document.addEventListener('focus', function (e) {
        if (!e.target.classList || !e.target.classList.contains('co-input') || e.target.tagName === 'SELECT') return;
        var f = e.target.closest('.co-field');
        if (f) f.classList.add('co-focused');
    }, true);
    document.addEventListener('blur', function (e) {
        if (!e.target.classList || !e.target.classList.contains('co-input') || e.target.tagName === 'SELECT') return;
        var f = e.target.closest('.co-field');
        if (f) f.classList.remove('co-focused');
        markFilled(e.target);
    }, true);
    document.addEventListener('input', function (e) {
        if (!e.target.classList || !e.target.classList.contains('co-input') || e.target.tagName === 'SELECT') return;
        markFilled(e.target);
    }, true);
    /* Init on load for any pre-filled values */
    document.querySelectorAll('.co-input:not(select)').forEach(markFilled);
}());
