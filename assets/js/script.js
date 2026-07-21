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

	function closeDrawer() {
		$(".site-header .header-bar").removeClass("active").attr("aria-expanded", "false");
		$(".site-header .main-menu").removeClass("active");
		$("#navOverlay").removeClass("active");
		$("body").removeClass("nav-open");
		setBarIcon(false);
	}

	$(".site-header .header-bar").on("click", function (e) {
		e.stopPropagation();
		var opening = !$(this).hasClass("active");
		if (opening) {
			$(this).addClass("active").attr("aria-expanded", "true");
			$(".site-header .main-menu").addClass("active");
			$("#navOverlay").addClass("active");
			$("body").addClass("nav-open");
			setBarIcon(true);
		} else {
			closeDrawer();
		}
	});

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
		$("[data-background").each(function () {
			bgObserver.observe(this);
		});
	} else {
		$("[data-background").each(function () {
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

	// Countdown area start here ***
	// Rolling 48h "offer ends in" window instead of a fixed calendar date —
	// a hardcoded date always eventually goes stale and freezes at a negative
	// value once it passes (this one was pinned to 2023-12-01 and had been
	// showing a broken negative countdown for years). Persisting the target
	// in localStorage means a returning visitor sees a consistent countdown
	// instead of it resetting on every reload, and it self-renews a fresh
	// 48h window on expiry instead of ever going stale again.
	var COUNTDOWN_KEY = "profit_offer_countdown_target";
	var COUNTDOWN_WINDOW_MS = 48 * 60 * 60 * 1000;
	var targetDate = parseInt(localStorage.getItem(COUNTDOWN_KEY), 10);
	if (!targetDate || targetDate <= Date.now()) {
		targetDate = Date.now() + COUNTDOWN_WINDOW_MS;
		localStorage.setItem(COUNTDOWN_KEY, targetDate);
	}
	var countdownInterval = setInterval(function () {
		var currentDate = new Date().getTime();
		var remainingTime = targetDate - currentDate;

		if (remainingTime <= 0) {
			targetDate = Date.now() + COUNTDOWN_WINDOW_MS;
			localStorage.setItem(COUNTDOWN_KEY, targetDate);
			remainingTime = targetDate - currentDate;
		}

		var days = Math.floor(remainingTime / (1000 * 60 * 60 * 24));
		var hours = Math.floor(
			(remainingTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
		);
		var minutes = Math.floor(
			(remainingTime % (1000 * 60 * 60)) / (1000 * 60)
		);
		var seconds = Math.floor((remainingTime % (1000 * 60)) / 1000);

		// Pad single-digit values with leading zeros
		$("#day").text(days.toString().padStart(2, "0"));
		$("#hour").text(hours.toString().padStart(2, "0"));
		$("#min").text(minutes.toString().padStart(2, "0"));
		$("#sec").text(seconds.toString().padStart(2, "0"));
	}, 1000);
	// Countdown area end here ***

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
		thumbs: {
			swiper: swiper,
		},
	});
	// Shop single swiper slider area end here ***

	// Hide & show by clicks js area start here ***
	$(document).on("click", "#openButton", function () {
		$("#targetElement").removeClass("side_bar_hidden");
	});
	$(document).on("click", "#closeButton", function () {
		$("#targetElement").addClass("side_bar_hidden");
	});
	// Hide & show by clicks js area end here ***

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
	$(document).ready(function () {
		$("select:not(.co-sel)").niceSelect();
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

	function renderCartDrawer() {
		var cart = getCart();
		var $body = $("#cartItems");
		$body.empty();
		if (cart.length === 0) {
			$body.html('<p class="cart-empty-msg">Your cart is empty.</p>');
			$("#cartTotal").text("$0.00");
			renderRecommendedProducts();
			return;
		}
		$.each(cart, function (i, item) {
			var img = item.img ? '<img src="' + escapeHtml(item.img) + '" alt="' + escapeHtml(item.name) + '">' : '<img src="/assets/images/placeholder.jpg" alt="">';
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
		renderRecommendedProducts();
	}

	// Compact "You might also like" row inside the cart drawer — only runs
	// where the drawer markup actually includes #cartRecommended (currently
	// shop-single.html), so pages without it are completely unaffected.
	function renderRecommendedProducts() {
		var $section = $("#cartRecommended");
		if (!$section.length || !window.ProFitAPI) return;

		var cartIds = getCart().map(function (item) { return item.id; });

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
				html += '<div class="cart-recommended__item" style="position:relative;">' +
					'<img src="' + escapeHtml(img) + '" alt="">' +
					'<span class="cart-recommended__name">' + escapeHtml(p.name) + '</span>' +
					'<span class="cart-recommended__price">$' + price + '</span>' +
					'<a href="' + link + '" class="cart-recommended__add stretched-link" data-add-to-cart data-id="' + p.id + '" data-slug="' + escapeHtml(p.slug) + '" data-name="' + escapeHtml(p.name) + '" data-price="' + price + '" data-img="' + escapeHtml(img) + '" aria-label="Add ' + escapeHtml(p.name) + ' to cart, $' + price + '">Add</a>' +
					'</div>';
			});
			html += '</div>';
			$section.html(html);
		}).catch(function () { $section.empty(); });
	}

	function openCartDrawer() {
		renderCartDrawer();
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
		var idx = cart.findIndex(function (i) { return i.id === id; });
		if (idx > -1) {
			cart[idx].qty -= 1;
			if (cart[idx].qty <= 0) cart.splice(idx, 1);
			saveCart(cart);
			renderCartDrawer();
			updateCartBadge();
		}
	});
	$(document).on("click", ".cart-qty-plus", function () {
		var id = $(this).data("id");
		var cart = getCart();
		var idx = cart.findIndex(function (i) { return i.id === id; });
		if (idx > -1) { cart[idx].qty += 1; saveCart(cart); renderCartDrawer(); updateCartBadge(); }
	});
	$(document).on("click", ".cart-item-remove", function () {
		var id = $(this).data("id");
		var cart = getCart().filter(function (i) { return i.id !== id; });
		saveCart(cart);
		renderCartDrawer();
		updateCartBadge();
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
		var existing = cart.find(function (i) { return i.id === id; });
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
		var existing = cart.find(function (i) { return i.id === id; });
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
					'<img src="' + escapeHtml(img) + '" alt="' + escapeHtml(item.name) + '" style="width:70px;height:70px;object-fit:cover;border-radius:8px;flex-shrink:0;">' +
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
		}

		renderCartPage();

		$(document).on("click", ".cp-remove", function () {
			var id = $(this).data("id");
			var cart = getCart().filter(function (i) { return i.id !== id; });
			saveCart(cart);
			renderCartPage();
			updateCartBadge();
		});

		$(document).on("click", ".cp-qty-minus", function () {
			var id = $(this).data("id");
			var cart = getCart();
			var idx = cart.findIndex(function (i) { return i.id === id; });
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
			var idx = cart.findIndex(function (i) { return i.id === id; });
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
					var imgHtml = item.img ? '<img src="' + escapeHtml(item.img) + '" class="co-item-img" alt="">' : '';
					$list.append(
						'<li class="co-order-item">' +
						imgHtml +
						'<span class="co-item-name">' + escapeHtml(item.name) + ' <em>&times;' + item.qty + '</em></span>' +
						'<span class="co-item-price">' + formatDollars(line) + '</span>' +
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
		}
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
