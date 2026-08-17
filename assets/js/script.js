/*-----------------------------------------------------------------

Template Name:  Odor - Vape Store WooCommerce HTML Template
Author:  Gramentheme
Author URI: https://themeforest.net/user/gramentheme/portfolio
Developer: Kawser Ahmed Roni
Version: 1.0.0
Description: Odor - Vape Store WooCommerce HTML Templatee

-------------------------------------------------------------------
CSS TABLE OF CONTENTS
-------------------------------------------------------------------

01. preloader
02. header
03. swiper slider
04. animated text with swiper slider
05. shop products count
06. image src change
07. hide & show a div
08. isotope
09. add class & remove class
10. magnificPopup
11. back to top
12. data backgrund
13. coundown by click
14. remove products
15. wow animation
15. Custom cursor

------------------------------------------------------------------*/

(function ($) {
	("use strict");

	function escapeHtml(str) {
		return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
			return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
		});
	}

	// Lean pages (program.html, my-library.html) deliberately don't ship the
	// full vendor bundle (Pace, Swiper, WOW, magnific, nice-select) — they're
	// the post-purchase surfaces where mobile load time matters most. Without
	// these local fallbacks, the first missing-library reference below throws
	// and silently kills EVERYTHING after it in this file — cart drawer,
	// add-to-cart, header — on exactly those pages. Missing library must mean
	// "skip that visual enhancement", never "abort all site JS".
	var Pace = window.Pace || { on: function () {} };
	var Swiper = window.Swiper || function () { this.on = function () {}; };
	var WOW = window.WOW || function () { this.init = function () {}; };
	if (!$.fn.magnificPopup) $.fn.magnificPopup = function () { return this; };
	if (!$.fn.niceSelect) $.fn.niceSelect = function () { return this; };

	// Mobile off-canvas drawer: hamburger opens/closes it, an overlay click
	// or Escape closes it, and tapping a top-level item that owns a panel
	// (.sub-menu / .mega-menu) expands it in place as a single-open
	// accordion — see the click handler below and style.css's mobile nav
	// rules (grid-template-rows 0fr/1fr on .open). Leaf links with no panel
	// just navigate normally; that handler only intercepts the ones that
	// own a panel. Deliberately doesn't reset any open panel here: an
	// accordion section stays open for as long as the drawer itself stays
	// open, even across a close/reopen.
	// Swaps the hamburger glyph between bars (closed) and X (open). Both are
	// Font Awesome 6 Pro solid icons, self-hosted with the project.
	function setBarIcon(open) {
		$(".site-header .header-bar__icon")
			.toggleClass("fa-bars", !open)
			.toggleClass("fa-xmark", open);
		$(".site-header .header-bar").attr("aria-label", open ? "Close menu" : "Open menu");
	}

	// iOS Safari ignores `overflow:hidden` on <body> for touch scrolling, so
	// the page behind the drawer still scrolled under your finger. Pinning the
	// body with position:fixed does hold, but collapses the scroll position to
	// 0 — so the offset is stashed and restored on unlock, which is what stops
	// the page jumping to the top every time the menu closes.
	var savedScrollY = 0;
	function lockBodyScroll() {
		savedScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
		document.body.style.top = -savedScrollY + "px";
		$("body").addClass("nav-open");
	}
	function unlockBodyScroll() {
		$("body").removeClass("nav-open");
		document.body.style.top = "";
		// 'instant' matters: a smooth restore animates the page back down and
		// reads as exactly the scroll-jump this is meant to prevent.
		window.scrollTo({ top: savedScrollY, behavior: "instant" });
	}

	function closeDrawer() {
		$(".site-header .header-bar").removeClass("active").attr("aria-expanded", "false");
		$(".site-header .main-menu").removeClass("active").css("transform", "");
		$("#navOverlay").removeClass("active").css("opacity", "");
		if ($("body").hasClass("nav-open")) unlockBodyScroll();
		setBarIcon(false);
	}

	function openDrawer() {
		$(".site-header .header-bar").addClass("active").attr("aria-expanded", "true");
		$(".site-header .main-menu").addClass("active").css("transform", "");
		$("#navOverlay").addClass("active").css("opacity", "");
		lockBodyScroll();
		setBarIcon(true);
	}

	$(".site-header .header-bar").on("click", function (e) {
		e.stopPropagation();
		if (!$(this).hasClass("active")) openDrawer();
		else closeDrawer();
	});

	// ---- Swipe-to-close ---------------------------------------------------
	// Native-feeling drag: the drawer tracks the finger 1:1, then either
	// completes or springs back based on how far AND how fast it was thrown.
	// Distance alone makes a quick flick feel unresponsive; velocity alone
	// makes a slow deliberate push fail.
	(function enableDrawerSwipe() {
		var drawer = document.querySelector(".site-header .main-menu");
		var overlay = document.getElementById("navOverlay");
		if (!drawer) return;

		var startX = 0, startY = 0, lastX = 0, lastT = 0, velocity = 0;
		var dragging = false, decided = false, width = 0;

		function isOpen() { return drawer.classList.contains("active"); }

		drawer.addEventListener("touchstart", function (e) {
			if (!isOpen() || e.touches.length !== 1) return;
			var t = e.touches[0];
			startX = lastX = t.clientX;
			startY = t.clientY;
			lastT = Date.now();
			velocity = 0;
			width = drawer.offsetWidth || 320;
			dragging = true;
			decided = false;
		}, { passive: true });

		drawer.addEventListener("touchmove", function (e) {
			if (!dragging) return;
			var t = e.touches[0];
			var dx = t.clientX - startX;
			var dy = t.clientY - startY;

			// The first meaningful movement decides the gesture's axis.
			// Without this, scrolling the menu vertically drags it sideways.
			if (!decided) {
				if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
				if (Math.abs(dy) > Math.abs(dx)) { dragging = false; return; }
				decided = true;
				drawer.classList.add("is-dragging");
				// Scrim tracks the finger too — see .nav-overlay.is-dragging.
				if (overlay) overlay.classList.add("is-dragging");
			}

			// Only closing (rightward) drags track 1:1. Pulling left past the
			// open position is damped rather than blocked, so the edge still
			// feels physical instead of dead.
			var offset = dx > 0 ? dx : dx / 4;
			var now = Date.now();
			var dt = now - lastT;
			if (dt > 0) velocity = (t.clientX - lastX) / dt; // px per ms
			lastX = t.clientX;
			lastT = now;

			drawer.style.transform = "translate3d(" + offset + "px,0,0)";
			// Overlay fades in step with the drawer so the two never desync.
			if (overlay) overlay.style.opacity = String(Math.max(0, 1 - offset / width));
		}, { passive: true });

		function endDrag() {
			if (!dragging) return;
			dragging = false;
			if (!decided) return;
			drawer.classList.remove("is-dragging");
			if (overlay) overlay.classList.remove("is-dragging");

			var offset = lastX - startX;
			// Either thrown hard enough, or dragged more than a third of the
			// way across. 0.45 px/ms is about a deliberate flick, not a drift.
			var shouldClose = velocity > 0.45 || offset > width * 0.33;

			if (shouldClose) {
				// Carry the throw's speed into the closing animation rather
				// than always using one duration — a hard flick finishes fast,
				// a gentle push glides.
				var remaining = Math.max(0, width - offset);
				var ms = velocity > 0.45
					? Math.min(320, Math.max(120, remaining / Math.abs(velocity)))
					: 280;
				drawer.style.transition = "transform " + Math.round(ms) + "ms cubic-bezier(0.32,0.72,0,1)";
				drawer.style.transform = "translate3d(100%,0,0)";
				setTimeout(function () {
					drawer.style.transition = "";
					closeDrawer();
				}, Math.round(ms));
			} else {
				drawer.style.transition = "";
				drawer.style.transform = "";
				if (overlay) overlay.style.opacity = "";
			}
		}

		drawer.addEventListener("touchend", endDrag, { passive: true });
		drawer.addEventListener("touchcancel", endDrag, { passive: true });
	})();

	$(document).on("click", "#navOverlay", closeDrawer);

	// Close mobile nav when clicking outside
	$(document).on("click", function (e) {
		if (!$(e.target).closest(".site-header").length) {
			closeDrawer();
		}
	});

	$(document).on("keydown", function (e) {
		if (e.key === "Escape" && $(window).width() < 992) closeDrawer();
	});

	// Inline accordion (mobile only): tapping a top-level item that owns a
	// panel (.sub-menu / .mega-menu) toggles it open/closed in place. Single-
	// open — opening one panel closes whichever other one was open first, so
	// there's never more than one expanded at a time. aria-expanded on the
	// trigger link is the only state this writes; style.css keys both the
	// panel's grid-template-rows and the chevron's rotation off .open/
	// [aria-expanded] directly, so there's nothing else to keep in sync.
	$(".site-header .main-menu > li > .nav-top-link").on("click", function (e) {
		if ($(window).width() >= 992) return;
		var $link = $(this);
		var $panel = $link.siblings("[data-menu-panel]");
		if (!$panel.length) return; // no panel: let it navigate
		e.preventDefault();
		var opening = !$panel.hasClass("open");

		$(".site-header .main-menu > li > [data-menu-panel].open").not($panel)
			.removeClass("open")
			.siblings(".nav-top-link")
			.attr("aria-expanded", "false");

		$panel.toggleClass("open", opening);
		$link.attr("aria-expanded", String(opening));
	});

	// Desktop hover/focus opens the dropdown visually via CSS alone; this
	// just keeps aria-expanded in sync with that so screen readers know
	// the real state, since CSS :hover/:focus-within can't touch ARIA.
	$(".site-header .main-menu > li").on("mouseenter focusin", function () {
		$(this).children(".nav-top-link").attr("aria-expanded", "true");
	}).on("mouseleave focusout", function () {
		var li = $(this);
		setTimeout(function () {
			if (!li.is(":hover") && li.find(":focus").length === 0) {
				li.children(".nav-top-link").attr("aria-expanded", "false");
			}
		}, 50);
	});

	var fixed_top = $(".site-header");
	$(window).on("scroll", function () {
		if ($(this).scrollTop() > 220) {
			fixed_top.addClass("menu-fixed");
		} else {
			fixed_top.removeClass("menu-fixed");
		}
	});

	// Preloader area start here ***
	paceOptions = {
		ajax: true,
		document: true,
		eventLag: false,
	};

	Pace.on("done", function () {
		$("#preloader").addClass("isdone");
		$(".loading").addClass("isdone");
	});
	// Preloader area end here ***

	// Banner five slider area end here ***
	var sliderActive3 = ".banner-two__slider";
	var sliderInit3 = new Swiper(sliderActive3, {
		loop: true,
		slidesPerView: 1,
		effect: "fade",
		speed: 3000,
		autoplay: {
			delay: 7000,
			disableOnInteraction: false,
		},
		navigation: {
			nextEl: ".banner-two__arry-next",
			prevEl: ".banner-two__arry-prev",
		},
	});
	// Here this is use for animate ***
	function animated_swiper(selector, init) {
		var animated = function animated() {
			$(selector + " [data-animation]").each(function () {
				var anim = $(this).data("animation");
				var delay = $(this).data("delay");
				var duration = $(this).data("duration");
				$(this)
					.removeClass("anim" + anim)
					.addClass(anim + " animated")
					.css({
						webkitAnimationDelay: delay,
						animationDelay: delay,
						webkitAnimationDuration: duration,
						animationDuration: duration,
					})
					.one("animationend", function () {
						$(this).removeClass(anim + " animated");
					});
			});
		};
		animated();
		init.on("slideChange", function () {
			$(sliderActive3 + " [data-animation]").removeClass("animated");
		});
		init.on("slideChange", animated);
	}
	animated_swiper(sliderActive3, sliderInit3);
	// Banner five slider area end here ***

	// Gallery slider area start here ***
	var swiper = new Swiper(".gallery__slider", {
		spaceBetween: 30,
		speed: 300,
		loop: true,
		centeredSlides: true,
		autoplay: {
			delay: 5000,
			disableOnInteraction: false,
		},
		breakpoints: {
			1300: {
				slidesPerView: 4,
			},
			991: {
				slidesPerView: 3,
			},
			768: {
				slidesPerView: 2,
			},
		},
	});
	// Gallery slider area end here ***

	// Category slider area start here ***
	var swiper = new Swiper(".category__slider", {
		spaceBetween: 30,
		speed: 500,
		loop: true,
		autoplay: {
			delay: 3000,
			disableOnInteraction: false,
		},
		breakpoints: {
			1440: {
				slidesPerView: 6,
			},
			1300: {
				slidesPerView: 5,
			},
			991: {
				slidesPerView: 4,
			},
			768: {
				slidesPerView: 3,
			},
			500: {
				slidesPerView: 2,
			},
		},
	});
	// Category slider area end here ***

	// Brand slider area start here ***
	var swiper = new Swiper(".brand__slider", {
		spaceBetween: 30,
		speed: 300,
		loop: true,
		autoplay: {
			delay: 3000,
			disableOnInteraction: false,
		},
		breakpoints: {
			1440: {
				slidesPerView: 6,
			},
			1300: {
				slidesPerView: 5,
			},
			991: {
				slidesPerView: 4,
			},
			768: {
				slidesPerView: 3,
			},
			500: {
				slidesPerView: 2,
			},
		},
	});
	// Brand slider area end here ***

	// Testimonial two slider area start here ***
	var swiper = new Swiper(".testimonial__slider", {
		loop: "true",
		spaceBetween: 20,
		speed: 500,
		autoplay: {
			delay: 4000,
			disableOnInteraction: false,
		},
		navigation: {
			nextEl: ".testimonial__arry-next",
			prevEl: ".testimonial__arry-prev",
		},
	});
	// Testimonial two slider area end here ***

	// Blog slider area start here ***
	var swiper = new Swiper(".blog__slider", {
		loop: "true",
		spaceBetween: 30,
		speed: 500,
		autoplay: {
			delay: 5000,
			disableOnInteraction: false,
		},
		pagination: {
			el: ".blog__dot",
			clickable: true,
		},
	});
	// Blog slider area end here ***

	// Get swiper slider area start here ***
	var swiper = new Swiper(".get__slider", {
		loop: "true",
		spaceBetween: 10,
		speed: 300,
		autoplay: {
			delay: 4000,
			disableOnInteraction: false,
		},
		navigation: {
			nextEl: ".get-now__arry-right",
			prevEl: ".get-now__arry-left",
		},
	});
	// Get swiper slider area end here ***

	// Background image date area start here ***
	// Lazy: only sets background-image once an element is near the
	// viewport, instead of every [data-background] element on the page
	// (header banner, mid-page sections, footer alike) eagerly fetching its
	// image on load regardless of scroll position. An element already in
	// view at load (e.g. a page's top banner) gets its callback almost
	// immediately, so this doesn't delay anything above the fold — it only
	// defers what's actually below it (e.g. the footer background, which is
	// otherwise downloaded on every single page load whether or not the
	// visitor ever scrolls that far).
	if ("IntersectionObserver" in window) {
		var bgObserver = new IntersectionObserver(
			function (entries) {
				entries.forEach(function (entry) {
					if (!entry.isIntersecting) return;
					var el = entry.target;
					$(el).css("background-image", "url( " + $(el).attr("data-background") + "  )");
					bgObserver.unobserve(el);
				});
			},
			{ rootMargin: "200px 0px" }
		);
		$("[data-background]").each(function () {
			bgObserver.observe(this);
		});
	} else {
		$("[data-background]").each(function () {
			$(this).css(
				"background-image",
				"url( " + $(this).attr("data-background") + "  )"
			);
		});
	}
	// Background image date area end here ***

	// Video popup area start here ***
	$(".video-popup").magnificPopup({
		type: "iframe",
		iframe: {
			markup:
				'<div class="mfp-iframe-scaler">' +
				'<div class="mfp-close"></div>' +
				'<iframe class="mfp-iframe" frameborder="0" allowfullscreen></iframe>' +
				"</div>",

			patterns: {
				youtube: {
					index: "youtube.com/",

					id: "v=",

					src: "https://www.youtube.com/embed/%id%?autoplay=1",
				},
				vimeo: {
					index: "vimeo.com/",
					id: "/",
					src: "//player.vimeo.com/video/%id%?autoplay=1",
				},
				gmaps: {
					index: "//maps.google.",
					src: "%id%&output=embed",
				},
			},

			srcAction: "iframe_src",
		},
	});
	// Video popup area end here ***

	// Countdown area removed 2026-08-11 ***
	// The theme's "HURRY UP! Offer end in:" timer was a rolling 48h window
	// persisted in localStorage that re-armed itself forever, so the deadline it
	// counted down to did not exist. It was dropped from the homepage along with
	// the "$79.00 -> $49.00" price it sat above, and the last markup carrying
	// #day/#hour/#min/#sec went with the deleted index-2/index-light variants —
	// so this ran a setInterval once a second, forever, on every page of the
	// site, writing into elements that no longer exist anywhere.
	//
	// If a REAL, dated offer is ever run, drive it from the Promotion row's
	// expiresAt (server/src/lib/promotions.js), not from a rolling window.

	// Shop single swiper slider area start here ***
	var swiper = new Swiper(".shop-slider-thumb", {
		loop: true,
		spaceBetween: 10,
		slidesPerView: 4,
		freeMode: true,
		watchSlidesProgress: true,
	});
	var swiper2 = new Swiper(".shop-single-slide", {
		loop: "true",
		spaceBetween: 20,
		speed: 300,
		grabCursor: true,
		pagination: {
			el: ".shop-single-pagination",
			clickable: true,
		},
		thumbs: {
			swiper: swiper,
		},
	});
	// The product page builds its real slide list from the CMS *after* this
	// runs (assets/js/shop-single.js, which has to wait on the product API),
	// so it needs these instances to re-sync once the slides change. Exposed
	// rather than re-initialized: re-running `new Swiper` on a live element
	// leaks the old instance's listeners.
	window.ProFitShopSwiper = { main: swiper2, thumbs: swiper };
	// Shop single swiper slider area end here ***

	// The #targetElement off-canvas sidebar these handlers drove has been
	// removed from every page: #openButton, its only trigger, existed in no
	// markup anywhere (not in the 19 pages, not in partials/header.html), so
	// the panel could never be opened. It was shipping placeholder template
	// content — a fake email, a fake phone number and lorem copy about road
	// subgrade — inside 13 pages for nothing.

	// Radio btn area start here ***
	$(document).on("click", ".radio-btn span", function () {
		$(this).toggleClass("radio-btn-active");
	});
	// Radio btn area end here ***

	// Mouse cursor area start here ***
	function mousecursor() {
		if ($("body")) {
			const e = document.querySelector(".cursor-inner"),
				t = document.querySelector(".cursor-outer");
			let n,
				i = 0,
				o = !1;
			(window.onmousemove = function (s) {
				o ||
					(t.style.transform =
						"translate(" + s.clientX + "px, " + s.clientY + "px)"),
					(e.style.transform =
						"translate(" + s.clientX + "px, " + s.clientY + "px)"),
					(n = s.clientY),
					(i = s.clientX);
			}),
				$("body").on("mouseenter", "a, .cursor-pointer", function () {
					e.classList.add("cursor-hover"), t.classList.add("cursor-hover");
				}),
				$("body").on("mouseleave", "a, .cursor-pointer", function () {
					($(this).is("a") && $(this).closest(".cursor-pointer").length) ||
						(e.classList.remove("cursor-hover"),
						t.classList.remove("cursor-hover"));
				}),
				(e.style.visibility = "visible"),
				(t.style.visibility = "visible");
		}
	}

	$(function () {
		if (window.matchMedia("(pointer: fine)").matches) {
			mousecursor();
		}
	});
	// Mouse cursor area end here ***

	// Nice seclect area start here ***
	//
	// Two opt-outs, both for the same reason: niceSelect HIDES the native
	// <select> (display:none) and renders its own widget from whatever
	// options exist AT INIT. Any select whose options are populated later by
	// JS therefore renders as an empty box — the native element is correct
	// and invisible, the widget is visible and blank, and nothing errors.
	//   .co-sel   the checkout's country picker
	//   .ac-select the customer area's selects (My Profile, setup wizard),
	//              which are filled from assets/js/countries.js after load
	$(document).ready(function () {
		$("select:not(.co-sel):not(.ac-select)").niceSelect();
	});
	// Nice seclect area end here ***

	// Back to top area start here ***
	// Guarded: lean pages (program.html, my-library.html) have no .scroll-up
	// widget — dereferencing the missing path used to throw here and kill
	// every handler registered below (cart drawer included) on those pages.
	var scrollPath = document.querySelector(".scroll-up path");
	if (scrollPath) {
		var pathLength = scrollPath.getTotalLength();
		scrollPath.style.transition = scrollPath.style.WebkitTransition = "none";
		scrollPath.style.strokeDasharray = pathLength + " " + pathLength;
		scrollPath.style.strokeDashoffset = pathLength;
		scrollPath.getBoundingClientRect();
		scrollPath.style.transition = scrollPath.style.WebkitTransition =
			"stroke-dashoffset 10ms linear";
		var updatescroll = function () {
			var scroll = $(window).scrollTop();
			var height = $(document).height() - $(window).height();
			var scroll = pathLength - (scroll * pathLength) / height;
			scrollPath.style.strokeDashoffset = scroll;
		};
		updatescroll();
		$(window).scroll(updatescroll);
	}
	var offset = 50;
	var duration = 950;
	jQuery(window).on("scroll", function () {
		if (jQuery(this).scrollTop() > offset) {
			jQuery(".scroll-up").addClass("active-scroll");
		} else {
			jQuery(".scroll-up").removeClass("active-scroll");
		}
	});
	jQuery(".scroll-up").on("click", function (event) {
		event.preventDefault();
		jQuery("html, body").animate(
			{
				scrollTop: 0,
			},
			duration
		);
		return false;
	});
	// Back to top area end here ***

	// WOW Animatin area start here ***
	new WOW().init();
	// WOW Animatin area start here ***

	// =====================================================
	// CART SYSTEM — localStorage persistence
	// =====================================================
	var CART_KEY = "odor_cart";

	// The cart stores item.price as a plain dollar string (parsed off the
	// product card's own displayed price), not cents like the product API —
	// so this is a separate helper from ProFitAPI.formatPrice(cents), not a
	// duplicate of it, even though the output looks the same.
	function formatDollars(amount) {
		return "$" + amount.toFixed(2);
	}

	function getCart() {
		try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
		catch (e) { return []; }
	}
	function saveCart(cart) {
		localStorage.setItem(CART_KEY, JSON.stringify(cart));
		// Single choke point for every cart mutation (drawer qty controls, whole-
		// card add, checkout recommendations, ...) — anything that needs to react
		// to the cart changing (the checkout page's order summary + Stripe
		// PaymentIntent resync) listens for this instead of each call site having
		// to know about every possible listener.
		document.dispatchEvent(new CustomEvent("profit:cart-changed"));
	}

	// "Buy Now" bypasses the cart entirely — the chosen product is stashed here
	// for checkout.html to read, then cleared once the order is placed.
	var BUYNOW_KEY = "odor_buynow";

	function setBuyNow(item) {
		sessionStorage.setItem(BUYNOW_KEY, JSON.stringify(item));
	}
	function clearBuyNow() {
		sessionStorage.removeItem(BUYNOW_KEY);
	}
	// Unified checkout source: a pending Buy Now item takes priority over the cart.
	function getCheckoutItems() {
		var buyNow = null;
		try { buyNow = JSON.parse(sessionStorage.getItem(BUYNOW_KEY)); } catch (e) { buyNow = null; }
		if (buyNow && buyNow.id) return [buyNow];
		return getCart();
	}

	// True when checkout is showing a Buy Now item rather than the cart. The
	// checkout summary's quantity and remove controls are suppressed in that
	// case: they mutate the cart, which is not what is being purchased.
	function buyNowActive() {
		try {
			var b = JSON.parse(sessionStorage.getItem(BUYNOW_KEY));
			return !!(b && b.id);
		} catch (e) { return false; }
	}

	window.ProFitCart = {
		getCart: getCart,
		saveCart: saveCart,
		setBuyNow: setBuyNow,
		clearBuyNow: clearBuyNow,
		getCheckoutItems: getCheckoutItems
	};

	function cartTotal(cart) {
		return cart.reduce(function (sum, item) {
			return sum + parseFloat(item.price) * item.qty;
		}, 0);
	}

	function updateCartBadge() {
		var cart = getCart();
		var count = cart.reduce(function (n, item) { return n + item.qty; }, 0);
		$("#cartCount, #cartDrawerCount, #drawerCartCount").text(count);
	}

	// ---- Cart thumbnails ---------------------------------------------------
	// The cart stores only the raw `imageUrl` a product was added with, i.e.
	// the ORIGINAL upload. Rendering that straight into <img src> is the same
	// bug that has now been found on four separate surfaces: every request
	// succeeds, so nothing ever flags it. Measured on the live drawer with
	// three items, 10/2 Mbps: 4,565,282 bytes of PNG (1290x2796, 1055x1491,
	// 1122x1402) to fill three 60x60 boxes, the last of them landing 3.7s
	// after the drawer opened.
	//
	// The 320w AVIF/WebP derivatives already exist for every raster cover —
	// nothing here generates anything, it only asks for what is there.
	// `listProducts()` is cached per page by api.js, so this costs at most one
	// request per page view and usually zero (the shop grid, checkout
	// recommendations and the drawer's own "you might also like" all prime it).
	var cartCoverIndex = null;

	function cartCoverFor(id) {
		if (!cartCoverIndex) return null;
		var p = cartCoverIndex[id];
		return p && p.cover ? p.cover : null;
	}

	// Replaces each placeholder <img> with the best source set available.
	// Deliberately falls back to the stored original for anything with no
	// cover: SVG demo covers, GIFs and stills below the 320w tier legitimately
	// have no derivatives, and the stored file IS the right one for those.
	//
	// Two callers, because there are two surfaces showing the same cart items
	// at two different box sizes: the drawer (60px) and the checkout order
	// summary (104px). The summary was rendering `item.img` — the ORIGINAL
	// upload — straight into <img src>, measured live at 1055x1491 / 2,245.6 KB
	// painted into a 104x104 box, against a 16.5 KB 320w AVIF that already
	// existed on disk. Same defect as the drawer had, one surface over.
	function paintThumbs(rowSelector, imgAttr, sizes) {
		var rows = document.querySelectorAll(rowSelector);
		if (!rows.length) return;
		Array.prototype.forEach.call(rows, function (row) {
			var img = row.querySelector("img[" + imgAttr + "]");
			if (!img) return;
			var stored = img.getAttribute("data-src") || "";
			var cover = cartCoverFor(row.getAttribute("data-id"));
			img.removeAttribute(imgAttr);

			if (!cover || !cover.sources || !cover.sources.length || !window.MediaContainer) {
				if (stored) img.src = stored;
				return;
			}

			// pictureFor() MOVES the img into the <picture> it returns, so the
			// insertion point has to be captured first — reading img.parentNode
			// afterwards gives the <picture> itself, not the row.
			var parent = img.parentNode;
			var next = img.nextSibling;
			// The rendered box, so even a 3x screen asks for no more than the
			// 320w tier.
			var picture = window.MediaContainer.pictureFor(img, cover, sizes);

			// src is set only now, with the <source> elements already in place,
			// so the browser runs picture selection and takes the AVIF/WebP.
			// Setting it while the img was still a bare child of the row would
			// have started the original's download before the sources existed —
			// which is the whole bug, moved a few lines later.
			// The fallback is the narrowest derivative rather than cover.src:
			// on the one path where a browser ignores <source> entirely, 320w
			// WebP is still the right answer and the 2MB PNG never is.
			img.src = window.MediaContainer.smallestDerivative(cover) || cover.src || stored;

			if (picture !== img && parent) parent.insertBefore(picture, next);
		});
	}

	function paintCartThumbs() {
		paintThumbs("#cartItems .cart-item", "data-cart-thumb", "60px");
		paintThumbs("#checkoutOrderList .co-order-item", "data-co-thumb", "104px");
		paintThumbs("#cartPageTable .product", "data-cartpage-thumb", "70px");
	}

	function ensureCartCovers() {
		if (cartCoverIndex) { paintCartThumbs(); return; }
		if (!window.ProFitAPI) { paintCartThumbs(); return; }
		window.ProFitAPI.listProducts().then(function (data) {
			cartCoverIndex = {};
			(data.products || []).forEach(function (p) { cartCoverIndex[p.id] = p; });
			paintCartThumbs();
		}).catch(function () {
			// Falls back to the stored original rather than to no image at
			// all — worse bytes, but a cart that still shows what is in it.
			paintCartThumbs();
		});
	}

	function renderCartDrawer() {
		var cart = getCart();
		var $body = $("#cartItems");
		$body.empty();
		if (cart.length === 0) {
			$body.html('<p class="cart-empty-msg">Your cart is empty.</p>');
			$("#cartTotal").text("$0.00");
			return;
		}
		$.each(cart, function (i, item) {
			// No `src` yet: setting the original here would start its download
			// immediately, and the upgrade below would then be a second
			// request rather than a replacement. width/height reserve the box
			// so the row never reflows once the real bytes land.
			var src = item.img || "/assets/images/placeholder.jpg";
			var img = '<img data-cart-thumb data-src="' + escapeHtml(src) + '"' +
				' alt="' + escapeHtml(item.name || "") + '" width="60" height="60"' +
				' loading="lazy" decoding="async">';
			var html = '<div class="cart-item" data-id="' + item.id + '">' +
				img +
				'<div class="cart-item-info">' +
				'<span class="cart-item-name">' + escapeHtml(item.name) + '</span>' +
				'<span class="cart-item-price">' + formatDollars(parseFloat(item.price) * item.qty) + '</span>' +
				'<div class="cart-item-qty">' +
				'<button class="cart-qty-minus" data-id="' + item.id + '">&#8722;</button>' +
				'<span>' + item.qty + '</span>' +
				'<button class="cart-qty-plus" data-id="' + item.id + '">&#43;</button>' +
				'</div>' +
				'</div>' +
				'<button class="cart-item-remove" data-id="' + item.id + '" aria-label="Remove"><i class="fa-solid fa-xmark"></i></button>' +
				'</div>';
			$body.append(html);
		});
		$("#cartTotal").text(formatDollars(cartTotal(cart)));
		ensureCartCovers();
	}

	// Compact "You might also like" row inside the cart drawer — only runs
	// where the drawer markup actually includes #cartRecommended (currently
	// shop-single.html), so pages without it are completely unaffected.
	//
	// Deliberately rebuilt only when the drawer OPENS, never on each cart
	// mutation. It used to run from renderCartDrawer(), which caused the
	// "removed item comes back" bug: this list excludes whatever is in the
	// cart, so removing an item made that item eligible again, and the async
	// listProducts() resolve then injected it as a new tile *after* the
	// removal had already reflowed the drawer. Each tile is a full-tile
	// add-to-cart target, so the shopper's next tap — aimed at the next
	// remove button — landed on the tile of the item they had just removed
	// and silently re-added it. Nothing was corrupting localStorage; the
	// item was genuinely being added back by a mis-aimed tap.
	function renderRecommendedProducts() {
		var $section = $("#cartRecommended");
		if (!$section.length || !window.ProFitAPI) return;

		var cartIds = getCart().map(function (item) { return item.id; });

		// Hold the row's height across the async fetch so its arrival doesn't
		// shove the cart rows above it (the other half of the mis-tap).
		if (!$section.children().length) $section.css("min-height", "0px");

		window.ProFitAPI.listProducts().then(function (data) {
			var picks = (data.products || [])
				.filter(function (p) { return cartIds.indexOf(p.id) === -1; })
				.slice(0, 3);

			if (!picks.length) { $section.empty(); return; }

			var html = '<p class="cart-recommended__title">You might also like</p><div class="cart-recommended__row">';
			picks.forEach(function (p) {
				var img = p.imageUrl || "/assets/images/placeholder.jpg";
				var price = (p.priceCents / 100).toFixed(2);
				var link = "/program/" + encodeURIComponent(p.slug);
				// The whole tile is one add-to-cart tap target: the "Add" anchor
				// stretches over the item (same pattern as product cards), with
				// the product page href only as an open-in-new-tab fallback.
				// No inline style="position:relative" here — the CSP's
				// style-src-attr blocks style attributes outright, so it never
				// applied. The rule lives in style.css (.cart-recommended__item)
				// where it actually takes effect.
				html += '<div class="cart-recommended__item">' +
					'<img src="' + escapeHtml(img) + '" alt="">' +
					'<span class="cart-recommended__name">' + escapeHtml(p.name) + '</span>' +
					'<span class="cart-recommended__price">$' + price + '</span>' +
					'<a href="' + link + '" class="cart-recommended__add stretched-link" data-add-to-cart data-id="' + p.id + '" data-slug="' + escapeHtml(p.slug) + '" data-name="' + escapeHtml(p.name) + '" data-price="' + price + '" data-img="' + escapeHtml(img) + '" aria-label="Add ' + escapeHtml(p.name) + ' to cart, $' + price + '">Add</a>' +
					'</div>';
			});
			html += '</div>';
			$section.html(html);
			// Freeze the height it settled at, so later removals reflow only
			// the item list above and never move these tap targets.
			$section.css("min-height", $section.outerHeight() + "px");
		}).catch(function () { $section.empty(); });
	}

	// Anything that mutates the cart from inside the drawer reflows the item
	// list. A tap that lands within a few hundred ms of that reflow is almost
	// certainly aimed at where the content *was*, so the recommendation tiles
	// (the only add-to-cart targets in the drawer) ignore it. Belt-and-braces
	// alongside not re-rendering them at all — a fast double-tap on a slow
	// phone can still outrun a reflow.
	var recsGuardedUntil = 0;
	function guardRecommendationsBriefly() {
		recsGuardedUntil = Date.now() + 350;
	}
	$(document).on("click", "#cartRecommended [data-add-to-cart]", function (e) {
		if (Date.now() < recsGuardedUntil) {
			e.preventDefault();
			e.stopImmediatePropagation();
		}
	});

	function openCartDrawer() {
		renderCartDrawer();
		renderRecommendedProducts();
		$("#cartDrawer, #cartOverlay").addClass("open");
		$("body").addClass("cart-open");
	}
	function closeCartDrawer() {
		$("#cartDrawer, #cartOverlay").removeClass("open");
		$("body").removeClass("cart-open");
	}

	$(document).on("click", "#cartToggle, .js-cart-toggle", function (e) {
		e.preventDefault();
		closeDrawer(); // no-op if the mobile nav drawer wasn't open, needed when Cart is tapped from inside it
		openCartDrawer();
	});
	$(document).on("click", "#cartClose, #cartOverlay", function () {
		closeCartDrawer();
	});

	// Qty controls inside drawer
	$(document).on("click", ".cart-qty-minus", function () {
		var id = $(this).data("id");
		var cart = getCart();
		var idx = cart.findIndex(function (i) { return String(i.id) === String(id); });
		if (idx > -1) {
			cart[idx].qty -= 1;
			if (cart[idx].qty <= 0) cart.splice(idx, 1);
			saveCart(cart);
			renderCartDrawer();
			updateCartBadge();
			guardRecommendationsBriefly();
		}
	});
	$(document).on("click", ".cart-qty-plus", function () {
		var id = $(this).data("id");
		var cart = getCart();
		var idx = cart.findIndex(function (i) { return String(i.id) === String(id); });
		if (idx > -1) {
			cart[idx].qty += 1;
			saveCart(cart);
			renderCartDrawer();
			updateCartBadge();
			guardRecommendationsBriefly();
		}
	});
	$(document).on("click", ".cart-item-remove", function () {
		var id = $(this).data("id");
		// Compare loosely on the string form: ids are cuids today, but the
		// shop-grid fallback path can synthesise a numeric-looking id, and
		// jQuery's .data() would hand that back as a Number while the stored
		// copy round-tripped through JSON as a String. A strict !== would
		// then quietly match nothing and the row would refuse to delete.
		var cart = getCart().filter(function (i) { return String(i.id) !== String(id); });
		saveCart(cart);
		renderCartDrawer();
		updateCartBadge();
		guardRecommendationsBriefly();
	});

	// Add to cart — works on any .product__cart button across shop pages
	$(document).on("click", ".product__cart", function (e) {
		e.preventDefault();
		var $btn = $(this);
		var $card = $btn.closest(".product__item, .product__wrp, [class*='product__']");
		if (!$card.length) $card = $btn.parent();

		var name = $card.find("h4 a, h5 a, h4, h5").first().text().trim() ||
			$btn.data("name") || "Product";
		// Sale price: look for del + next span (sale), or .primary-color span, or any price text
		var $priceEl = $card.find("del").next("span").first();
		if (!$priceEl.length) $priceEl = $card.find(".primary-color").first();
		var priceRaw = $priceEl.text().trim();
		var price = parseFloat(priceRaw.replace(/[^0-9.]/g, "")) || parseFloat($btn.data("price")) || 0;
		var img = $card.find("img").first().attr("src") || $btn.data("img") || "";
		var id = $btn.data("id") || (name + "_" + price).replace(/\s+/g, "_");
		var slug = $btn.data("slug") || null;

		var cart = getCart();
		var existing = cart.find(function (i) { return String(i.id) === String(id); });
		if (existing) {
			existing.qty += 1;
		} else {
			cart.push({ id: id, slug: slug, name: name, price: price, img: img, qty: 1 });
		}
		saveCart(cart);
		updateCartBadge();

		$btn.addClass("added");
		setTimeout(function () { $btn.removeClass("added"); }, 900);

		openCartDrawer();
	});

	// Whole-card add to cart — product cards and drawer recommendations carry
	// a single [data-add-to-cart] anchor stretched over the whole card, so a
	// tap anywhere on the card adds the product and opens the cart drawer
	// (whose Checkout button continues the purchase). The anchor's href is
	// only a fallback for open-in-new-tab / no-JS.
	$(document).on("click", "[data-add-to-cart]", function (e) {
		e.preventDefault();
		var $el = $(this);
		var id = $el.data("id");
		if (!id) return;

		var cart = getCart();
		var existing = cart.find(function (i) { return String(i.id) === String(id); });
		if (existing) {
			existing.qty += 1;
		} else {
			cart.push({
				id: id,
				slug: $el.data("slug") || null,
				name: $el.data("name") || "Product",
				price: parseFloat($el.data("price")) || 0,
				img: $el.data("img") || "",
				qty: 1,
			});
		}
		saveCart(cart);
		updateCartBadge();

		var $card = $el.closest(".product__item--tap");
		$card.addClass("added");
		setTimeout(function () { $card.removeClass("added"); }, 1200);

		// On checkout.html the order summary panel already shows the cart in
		// full — popping the drawer on top of it would just duplicate that same
		// information over the page the shopper is already on.
		if (!$("#checkoutOrderList").length) openCartDrawer();
	});

	// Buy Now — skips the cart, goes straight to checkout for this one product
	$(document).on("click", ".product__buy-now", function (e) {
		e.preventDefault();
		var $btn = $(this);
		var $card = $btn.closest(".product__item, .product__wrp, [class*='product__']");
		if (!$card.length) $card = $btn.parent();

		var name = $card.find("h4 a, h5 a, h3, h4, h5").first().text().trim() ||
			$btn.data("name") || "Product";
		var $priceEl = $card.find("del").next("span").first();
		if (!$priceEl.length) $priceEl = $card.find(".primary-color").first();
		var priceRaw = $priceEl.text().trim();
		var price = parseFloat(priceRaw.replace(/[^0-9.]/g, "")) || parseFloat($btn.data("price")) || 0;
		var img = $card.find("img").first().attr("src") || $btn.data("img") || "";
		var id = $btn.data("id");

		if (!id) {
			alert("This product isn't available for purchase yet.");
			return;
		}

		setBuyNow({ id: id, name: name, price: price, img: img, qty: 1 });
		window.location.href = "/checkout?buynow=1";
	});

	// Init badge on page load
	updateCartBadge();

	// =====================================================
	// CART PAGE — full interactive table
	// =====================================================
	if ($("#cartPageTable").length) {

		function renderCartPage() {
			var cart = getCart();
			var $table = $("#cartPageTable");
			var $empty = $("#cartPageEmpty");
			var $actions = $("#cartPageActions");

			if (cart.length === 0) {
				$table.hide();
				$actions.hide();
				$empty.show();
				return;
			}
			$empty.hide();
			$table.show();
			$actions.show();

			var html = '<div class="column-labels py-3 px-4 d-flex justify-content-between align-items-center fw-bold text-white text-uppercase">' +
				'<label class="product-details">Product</label>' +
				'<label class="product-price">Price</label>' +
				'<label class="product-quantity">Quantity</label>' +
				'<label class="product-line-price">Total</label>' +
				'<label class="product-removal">Remove</label>' +
				'</div>';

			var subtotal = 0;
			$.each(cart, function (i, item) {
				var lineTotal = parseFloat(item.price) * item.qty;
				subtotal += lineTotal;
				var img = item.img || "/assets/images/shop/01.jpg";
				var borderClass = (i < cart.length - 1) ? "bor-bottom" : "";
				// The product's public URL is slug-based (/program/<slug>), never
				// the internal id — a cart line added before this field existed
				// (stale localStorage from an older visit) has no slug yet; render
				// its name as plain unlinked text rather than ever falling back to
				// the raw id in the address bar. It self-heals next time the item
				// is re-added or the cart is cleared at checkout.
				var titleHtml = item.slug
					? '<a href="/program/' + encodeURIComponent(item.slug) + '" class="stretched-link" style="color:inherit;">' + escapeHtml(item.name) + '</a>'
					: escapeHtml(item.name);
				html += '<div class="product p-4 ' + borderClass + ' d-flex justify-content-between align-items-center" data-id="' + item.id + '" style="position:relative;">' +
					'<div class="product-details d-flex align-items-center">' +
					// Same src-less placeholder as the drawer and the checkout summary:
					// the stored value is the ORIGINAL upload (measured here at
					// 1055x1491 / 2,241.9 KB inside a 70x70 box) and setting it now
					// would start that download before paintThumbs can substitute the
					// 320w derivative.
					'<img data-cartpage-thumb data-src="' + escapeHtml(img) + '" class="cp-thumb"' +
					' alt="' + escapeHtml(item.name) + '" width="70" height="70" loading="lazy" decoding="async">' +
					'<h4 class="ps-4 text-capitalize mb-0">' + titleHtml + '</h4>' +
					'</div>' +
					'<div class="product-price text-white">' + formatDollars(parseFloat(item.price)) + '</div>' +
					'<div class="product-quantity">' +
					'<div class="cp-qty-wrap d-flex align-items-center gap-2">' +
					'<button class="cp-qty-btn cp-qty-minus" data-id="' + item.id + '">&#8722;</button>' +
					'<span class="cp-qty-val text-white">' + item.qty + '</span>' +
					'<button class="cp-qty-btn cp-qty-plus" data-id="' + item.id + '">&#43;</button>' +
					'</div>' +
					'</div>' +
					'<div class="product-line-price text-white cp-line-total">' + formatDollars(lineTotal) + '</div>' +
					'<div class="product-removal">' +
					'<button class="remove-product cp-remove" data-id="' + item.id + '" aria-label="Remove">' +
					'<i class="fa-solid fa-xmark"></i>' +
					'</button>' +
					'</div>' +
					'</div>';
			});

			html += '<div class="cart-page-totals px-4 py-20">' +
				'<div class="d-flex justify-content-end align-items-center gap-3">' +
				'<span class="fw-bold text-uppercase text-white">Cart Total:</span>' +
				'<span class="cp-subtotal-val" style="color:var(--primary-color);font-size:20px;font-weight:700;">' + formatDollars(subtotal) + '</span>' +
				'</div>' +
				'</div>';

			$table.html(html);
			// Swaps each placeholder for its <picture>; see renderCheckoutSummary.
			ensureCartCovers();
		}

		renderCartPage();

		$(document).on("click", ".cp-remove", function () {
			var id = $(this).data("id");
			// Same String() coercion guard as the drawer handlers above.
			var cart = getCart().filter(function (i) { return String(i.id) !== String(id); });
			saveCart(cart);
			renderCartPage();
			updateCartBadge();
		});

		$(document).on("click", ".cp-qty-minus", function () {
			var id = $(this).data("id");
			var cart = getCart();
			var idx = cart.findIndex(function (i) { return String(i.id) === String(id); });
			if (idx > -1) {
				cart[idx].qty -= 1;
				if (cart[idx].qty <= 0) cart.splice(idx, 1);
				saveCart(cart);
				renderCartPage();
				updateCartBadge();
			}
		});

		$(document).on("click", ".cp-qty-plus", function () {
			var id = $(this).data("id");
			var cart = getCart();
			var idx = cart.findIndex(function (i) { return String(i.id) === String(id); });
			if (idx > -1) {
				cart[idx].qty += 1;
				saveCart(cart);
				renderCartPage();
				updateCartBadge();
			}
		});
	}
	// =====================================================
	// END CART PAGE
	// =====================================================

	// =====================================================
	// CHECKOUT PAGE — dynamic order summary + payment + place order
	// =====================================================
	if ($("#checkoutOrderList").length) {

		// --- Promo code ---
		// appliedPromo (manually entered, confirmed via /api/promotions/validate)
		// takes visual precedence over autoPromo (a site-wide/category auto-apply
		// promotion, discovered without any code) in this preview banner. The
		// authoritative combined total — including a possible stacked
		// auto-apply promotion alongside a manual one — is always computed
		// server-side at create/update-intent time (server/src/lib/
		// checkoutItems.js); this preview intentionally doesn't replicate that
		// full combination logic, it just needs to be in the right ballpark and
		// never overstate what the shopper will actually be charged.
		var appliedPromo = null; // { code, name, discountCents }
		var autoPromo = null;
		window.ProFitCart.appliedPromoCode = null;

		function checkoutItemsForPromo() {
			return getCheckoutItems().map(function (item) { return { productId: item.id, qty: item.qty || 1 }; });
		}
		function currentEmailForPromo() {
			var el = document.getElementById("email");
			return el ? el.value.trim().toLowerCase() : "";
		}
		function showPromoMsg(message, isError) {
			var $el = $("#promoMsg");
			if (!$el.length) return;
			if (!message) { $el.addClass("u-hidden").text(""); return; }
			$el.text(message).removeClass("u-hidden").toggleClass("is-error", !!isError).toggleClass("is-success", !isError);
		}
		// Only called when no manual code is applied — a single, cart-driven
		// (not polled) check for a site-wide/category promotion that needs no
		// code at all.
		function refreshAutoPromo() {
			if (appliedPromo) { autoPromo = null; return Promise.resolve(); }
			var items = checkoutItemsForPromo();
			if (!items.length) { autoPromo = null; return Promise.resolve(); }
			return window.ProFitAPI.getAutoApplyPromotion(items, currentEmailForPromo()).then(function (data) {
				autoPromo = data.applied ? { code: data.promotion.code, name: data.promotion.name, discountCents: data.discountCents } : null;
			}).catch(function () { autoPromo = null; });
		}

		// --- Order summary ---
		function renderCheckoutSummary() {
			var cart = getCheckoutItems();
			var $list = $("#checkoutOrderList");
			$list.empty();
			var subtotal = 0;
			if (cart.length === 0) {
				$list.append('<li class="co-order-item co-empty"><span>No items in cart</span><span>$0.00</span></li>');
			} else {
				$.each(cart, function (i, item) {
					var line = parseFloat(item.price) * item.qty;
					subtotal += line;
					// No `src` yet, exactly as the drawer does it: setting the stored
					// original here would start its download immediately and the
					// upgrade below would be a second request rather than a
					// replacement. ensureCartCovers() -> paintThumbs() swaps in the
					// <picture> with the AVIF/WebP srcsets once the product index is
					// in. width/height reserve the 104px box so the summary does not
					// reflow when the cover lands.
					var imgHtml = item.img
						? '<img data-co-thumb data-src="' + escapeHtml(item.img) + '" class="co-item-img"' +
						  ' alt="" width="104" height="104" loading="lazy" decoding="async">'
						: '<span class="co-item-img co-item-img--empty"></span>';
					// Buy Now bypasses the cart, so its single item has no cart entry to
					// increment or remove -- the controls would be writing to a cart the
					// shopper is not actually buying from.
					var editable = !buyNowActive();
					var controls = editable
						? '<div class="co-item-qty">' +
						  '<button type="button" class="co-qty-btn co-qty-minus" data-id="' + escapeHtml(item.id) + '" aria-label="Decrease quantity">&#8722;</button>' +
						  '<span class="co-qty-val">' + item.qty + '</span>' +
						  '<button type="button" class="co-qty-btn co-qty-plus" data-id="' + escapeHtml(item.id) + '" aria-label="Increase quantity">&#43;</button>' +
						  '</div>'
						: '<span class="co-item-qty-static">Qty ' + item.qty + '</span>';
					var removeBtn = editable
						? '<button type="button" class="co-item-remove" data-id="' + escapeHtml(item.id) + '" aria-label="Remove ' + escapeHtml(item.name) + '"><i class="fa-solid fa-xmark"></i></button>'
						: '';
					$list.append(
						'<li class="co-order-item" data-id="' + escapeHtml(item.id) + '">' +
						imgHtml +
						'<div class="co-item-main">' +
						'<span class="co-item-name">' + escapeHtml(item.name) + '</span>' +
						(item.creator ? '<span class="co-item-creator">' + escapeHtml(item.creator) + '</span>' : '') +
						controls +
						'</div>' +
						'<div class="co-item-side">' +
						'<span class="co-item-price">' + formatDollars(line) + '</span>' +
						removeBtn +
						'</div>' +
						'</li>'
					);
				});
			}
			$("#coSubtotal").text(formatDollars(subtotal));

			var subtotalCents = Math.round(subtotal * 100);
			var discountCents = Math.min((appliedPromo || autoPromo || {}).discountCents || 0, subtotalCents);
			if (discountCents > 0) {
				$("#coDiscountRow").removeClass("u-hidden");
				$("#coDiscount").text("−" + formatDollars(discountCents / 100));
			} else {
				$("#coDiscountRow").addClass("u-hidden");
			}
			$("#coTotal").text(formatDollars((subtotalCents - discountCents) / 100));

			// Swap each placeholder thumbnail for its <picture>. Runs on EVERY
			// re-render (qty change, promo, remove), not just the first, because
			// the list is rebuilt from scratch each time and a fresh row would
			// otherwise be left with a src-less img. The product index is fetched
			// once and cached, so repeat calls cost nothing.
			ensureCartCovers();
		}
		// Quantity and remove, inline in the order summary. These write through
		// saveCart(), which dispatches profit:cart-changed -- the same event the
		// summary, the sticky bar and checkout-payments.js's PaymentIntent resync
		// all listen for, so one mutation updates every one of them and the
		// charged amount can never drift from what is displayed.
		function adjustQty(id, delta) {
			if (buyNowActive()) return;
			var cart = getCart();
			var idx = cart.findIndex(function (i) { return String(i.id) === String(id); });
			if (idx < 0) return;
			cart[idx].qty += delta;
			if (cart[idx].qty <= 0) cart.splice(idx, 1);
			saveCart(cart);
			updateCartBadge();
			renderCheckoutSummary();
		}
		$(document).on("click", "#checkoutOrderList .co-qty-plus", function () { adjustQty($(this).data("id"), 1); });
		$(document).on("click", "#checkoutOrderList .co-qty-minus", function () { adjustQty($(this).data("id"), -1); });
		$(document).on("click", "#checkoutOrderList .co-item-remove", function () {
			if (buyNowActive()) return;
			var id = $(this).data("id");
			var $row = $(this).closest(".co-order-item");
			// Let the row collapse before re-rendering, so an item does not just
			// vanish and snap the rows below it upward.
			$row.addClass("is-removing");
			setTimeout(function () {
				saveCart(getCart().filter(function (i) { return String(i.id) !== String(id); }));
				updateCartBadge();
				renderCheckoutSummary();
			}, 200);
		});

		renderCheckoutSummary();
		refreshAutoPromo().then(renderCheckoutSummary);
		// Adding a checkout-page recommendation (or any other cart mutation)
		// re-renders the summary instantly — no page reload, no polling. If a
		// promo code is already applied, it's silently re-validated once per
		// change (a min-spend code can stop qualifying as the cart shrinks);
		// with none applied, auto-apply eligibility is re-checked instead.
		document.addEventListener("profit:cart-changed", function () {
			if (appliedPromo) {
				var items = checkoutItemsForPromo();
				window.ProFitAPI.validatePromoCode(appliedPromo.code, items, currentEmailForPromo()).then(function (data) {
					if (!data.ok) {
						appliedPromo = null;
						window.ProFitCart.appliedPromoCode = null;
						showPromoMsg("\"" + $("#promoCodeInput").val().trim() + "\" no longer applies to your cart.", true);
					} else {
						appliedPromo.discountCents = data.discountCents;
					}
					renderCheckoutSummary();
				}).catch(function () { renderCheckoutSummary(); });
			} else {
				refreshAutoPromo().then(renderCheckoutSummary);
			}
		});

		$("#promoApplyBtn").on("click", function () {
			var $btn = $(this);
			var code = $("#promoCodeInput").val().trim();
			if (!code) { showPromoMsg("Enter a promo code", true); return; }
			var items = checkoutItemsForPromo();
			if (!items.length) { showPromoMsg("Your cart is empty", true); return; }

			$btn.prop("disabled", true);
			window.ProFitAPI.validatePromoCode(code, items, currentEmailForPromo()).then(function (data) {
				$btn.prop("disabled", false);
				if (!data.ok) {
					showPromoMsg(data.reason || "This code isn't valid", true);
					return;
				}
				appliedPromo = { code: data.promotion.code, name: data.promotion.name, discountCents: data.discountCents };
				autoPromo = null;
				window.ProFitCart.appliedPromoCode = appliedPromo.code;
				showPromoMsg("“" + data.promotion.code + "” applied — " + formatDollars(data.discountCents / 100) + " off", false);
				renderCheckoutSummary();
				// Keeps the live PaymentIntent's charged amount (and PayPal's
				// next create-order call) in sync with the newly applied code —
				// same event checkout-payments.js already listens for on any
				// other cart mutation.
				document.dispatchEvent(new CustomEvent("profit:cart-changed"));
			}).catch(function (err) {
				$btn.prop("disabled", false);
				showPromoMsg(err.message || "Could not validate this code", true);
			});
		});

		// --- Express pay buttons (scroll to tab) ---
		$(document).on("click", ".co-express-btn", function () {
			var method = $(this).data("express");
			$('[data-method="' + method + '"]').trigger("click");
			$(".co-section:last-of-type")[0].scrollIntoView({ behavior: "smooth", block: "start" });
		});

		// --- Payment tabs ---
		var activePayMethod = "card";
		$(document).on("click", ".pay-tab", function () {
			$(".pay-tab").removeClass("active");
			$(this).addClass("active");
			activePayMethod = $(this).data("method");
			$(".pay-panel").addClass("pay-panel--hidden");
			$("#panel-" + activePayMethod).removeClass("pay-panel--hidden");
		});

		// Real "Place Order" submission (Stripe/PayPal wiring, billing validation,
		// recommendation module) lives in assets/js/checkout-payments.js — it
		// needs to orchestrate async payment confirmation that this cosmetic
		// file doesn't. The actual card fields are Stripe's own Payment Element
		// (#stripe-payment-element), not a hand-rolled card form.
	}
	// =====================================================
	// END CHECKOUT PAGE
	// =====================================================

	// =====================================================
	// END CART SYSTEM
	// =====================================================

})(jQuery);

// =====================================================================
// MOBILE FOOTER ACCORDION
// =====================================================================
// Collapses the footer's link columns behind their headings below 768px.
// Progressive enhancement: the [aria-expanded] attribute this adds is what
// the CSS keys the collapsed state off, so with JS unavailable the footer
// stays fully expanded and every link remains reachable.
(function footerAccordion($) {
	var MOBILE = 767;
	var wired = false;

	function titles() {
		// The newsletter column is excluded — it holds a single input rather
		// than a link list, so collapsing it costs a tap and saves nothing.
		return $(".footer-area .footer__item").not(".newsletter").find("> .footer-title");
	}

	// Legal and Social live outside the link columns in the markup (the
	// bottom bar and the newsletter block respectively), so on mobile they
	// are mirrored into two extra accordion sections. Built here rather than
	// added to all 18 pages' HTML for the same reason the rest of this
	// feature is JS-driven: there is no footer partial, so per-page markup
	// would have to be applied 18 times and would drift. Removed again on
	// desktop, which keeps the desktop footer byte-for-byte as it was.
	var SYNTHETIC = "js-footer-synthetic";

	// Legal links carry their own text; social links are icon-only, so their
	// label is recovered from the Font Awesome brand class. Those classes
	// carry glyph-variant suffixes ("fa-facebook-f", "fa-linkedin-in") that
	// are not part of the brand name, hence the explicit map rather than
	// prettifying the class string and shipping "Linkedin in".
	var BRAND_LABELS = {
		"facebook-f": "Facebook", facebook: "Facebook",
		twitter: "Twitter", "x-twitter": "X",
		"linkedin-in": "LinkedIn", linkedin: "LinkedIn",
		youtube: "YouTube", instagram: "Instagram",
		tiktok: "TikTok", whatsapp: "WhatsApp",
	};

	function labelFor($a) {
		var text = $.trim($a.text());
		if (text) return text;
		if ($a.attr("aria-label")) return $a.attr("aria-label");
		var cls = ($a.find("i").attr("class") || "").match(/fa-([a-z0-9-]+)/g) || [];
		for (var i = 0; i < cls.length; i++) {
			var key = cls[i].replace(/^fa-/, "");
			if (BRAND_LABELS[key]) return BRAND_LABELS[key];
		}
		return "Link";
	}

	function buildSyntheticSections() {
		var $row = $(".footer-area .footer__wrp .row").first();
		if (!$row.length || $row.find("." + SYNTHETIC).length) return;

		function section(title, $links) {
			if (!$links.length) return null;
			var $col = $('<div class="col-12 ' + SYNTHETIC + '"><div class="footer__item"><h4 class="footer-title"></h4><ul></ul></div></div>');
			$col.find(".footer-title").text(title);
			var $ul = $col.find("ul");
			$links.each(function () {
				var $a = $(this);
				$ul.append(
					$("<li>").append(
						$("<a>").attr("href", $a.attr("href") || "#0")
							.append($("<span>"))
							.append(document.createTextNode(labelFor($a)))
					)
				);
			});
			return $col;
		}

		var $legal = section("Legal", $(".footer-area .footer__legal a"));
		var $social = section("Social", $(".footer-area .social-icon a"));
		if ($legal) $row.append($legal);
		if ($social) $row.append($social);
	}

	function removeSyntheticSections() {
		$(".footer-area ." + SYNTHETIC).remove();
	}

	function enable() {
		if (wired) return;
		wired = true;
		buildSyntheticSections();
		titles().each(function (i) {
			var $t = $(this);
			$t.attr({ role: "button", tabindex: "0", "aria-expanded": "false" });
			// First section open by default: an all-collapsed footer reads as
			// empty, and Customer Service is the one people actually want.
			//
			// Indexed off the collection, NOT :first-of-type — every
			// .footer__item sits in its own Bootstrap column, so each one is
			// the first (and only) .footer__item within its own parent and
			// :first-of-type matched all of them, opening every section.
			if (i === 0) {
				$t.attr("aria-expanded", "true").closest(".footer__item").addClass("is-open");
			}
		});
	}

	function disable() {
		if (!wired) return;
		wired = false;
		titles().removeAttr("role tabindex aria-expanded")
			.closest(".footer__item").removeClass("is-open");
		removeSyntheticSections();
	}

	function sync() {
		if ($(window).width() <= MOBILE) enable();
		else disable();
	}

	$(document).on("click keydown", ".footer-area .footer__item:not(.newsletter) > .footer-title[aria-expanded]", function (e) {
		if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
		e.preventDefault();
		var $t = $(this);
		var $item = $t.closest(".footer__item");
		var opening = !$item.hasClass("is-open");
		// Multi-open rather than single-open: footer sections are short and
		// unrelated, so closing one to read another would just add taps.
		$item.toggleClass("is-open", opening);
		$t.attr("aria-expanded", String(opening));
	});

	$(sync);
	// Debounced so an orientation change or a desktop resize drag doesn't
	// rebuild the attributes on every intermediate width.
	var t;
	$(window).on("resize", function () { clearTimeout(t); t = setTimeout(sync, 150); });
})(jQuery);
