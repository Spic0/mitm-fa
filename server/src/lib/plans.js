// The buyer guides behind /plans and /plans/:slug.
//
// WHY THESE PAGES EXIST: each one answers a search people in the US and
// Canada actually type (checked against Google autocomplete, Oct 2026):
// "workout plans for women", "workout plans for men", "athlete workout
// program", "meal plan for muscle gain", "hyrox training plan", "glp-1
// workout plan", "mobility routine for athletes". The storefront's own pages
// are named after goals and people, so none of those queries had a page to
// land on.
//
// Same rule as lib/services.js: no invented numbers, results, testimonials or
// medical claims. The copy explains what a good plan contains and how to
// choose one, then hands the reader to the real catalogue (goal and sport
// pages), so it stays true however the catalogue changes.

const PLANS = [
  {
    slug: "workout-plans-for-women",
    navLabel: "Workout Plans for Women",
    title: "Workout Plans for Women: Lose Fat, Build Muscle, Get Strong",
    description:
      "Structured workout plans for women from athletes and coaches: fat loss, muscle, strength and beginner programs. One-time purchase, lifetime access.",
    kicker: "Training plans",
    h1: "Workout plans for women",
    lead:
      "Programs written by athletes and coaches who train this way themselves, organised by what you want: lose fat, build muscle, get stronger or simply start.",
    sections: [
      {
        heading: "What makes a workout plan work",
        body: [
          "Most people do not stall because they picked the wrong exercises. They stall because nothing tells them what to do next week. A real plan answers that in advance: which sessions, in what order, how many sets and reps, and when the weights should go up.",
          "That is the difference between a plan and a list of workouts. Every program on Fitness Agency runs for a set number of weeks, with progression built in, so each session has a reason to exist and you can see whether it is working.",
        ],
      },
      {
        heading: "Strength training is the foundation, whatever the goal",
        body: [
          "Whether the goal is losing fat, looking more toned or getting stronger, lifting is the part that changes how your body looks and performs. Cardio and conditioning support it; they do not replace it.",
          "If you are new to the gym, start with a beginner-friendly plan that teaches the main lifts with lighter loads and clear technique cues. If you already train, pick by goal and by how many days a week you can honestly commit to.",
        ],
      },
    ],
    includes: [
      { title: "A fixed number of weeks", body: "A start, a finish and a reason to show up for every session in between." },
      { title: "Progression you can follow", body: "Sets, reps and loads that change week to week, written down, not left to guesswork." },
      { title: "Sessions that fit your week", body: "Plans are built around a realistic number of training days, not an ideal one." },
      { title: "Yours to keep", body: "One-time purchase and lifetime access. No subscription to cancel later." },
    ],
    links: [
      { label: "Fat loss plans", href: "/goal/lose-fat" },
      { label: "Muscle building plans", href: "/goal/gain-muscle" },
      { label: "Beginner-friendly plans", href: "/goal/beginner-friendly" },
      { label: "Strength plans", href: "/goal/strength" },
    ],
    faq: [
      { q: "How many days a week should I train?", a: "Three to four strength sessions a week is enough for most people to make steady progress. Choose a plan that matches the days you can actually train, because consistency beats volume." },
      { q: "Will lifting weights make me bulky?", a: "Building noticeable muscle takes years of deliberate training and eating for it. A typical strength plan makes you stronger and changes your shape; it does not add size by accident." },
      { q: "Do I need a gym?", a: "Most plans assume access to a gym with barbells, dumbbells and machines. Each plan lists the equipment it needs before you buy." },
    ],
  },
  {
    slug: "workout-plans-for-men",
    navLabel: "Workout Plans for Men",
    title: "Workout Plans for Men: Muscle, Strength and Size Programs",
    description:
      "Workout plans for men built by athletes and coaches: muscle gain, strength, size and conditioning. Structured weeks, clear progression, lifetime access.",
    kicker: "Training plans",
    h1: "Workout plans for men",
    lead:
      "Muscle, strength and conditioning programs from the athletes and coaches who use them, with every week, set and rep written out.",
    sections: [
      {
        heading: "Pick by goal, then by schedule",
        body: [
          "The right plan is the one built for what you want and the time you actually have. Muscle gain plans prioritise volume across the week. Strength plans spend more time on heavy compound lifts and longer rest. Conditioning plans build the engine that makes everything else easier.",
          "Then be honest about your week. A four-day plan you finish beats a six-day plan you abandon in week three.",
        ],
      },
      {
        heading: "Progression is the whole point",
        body: [
          "Turning up and training hard is not the same as getting better. Progress comes from doing slightly more over time: more weight, more reps or more quality. Every plan here spells that out, week by week, so you are never guessing.",
          "Each program also explains how the creator trains, so you are following a method, not a random collection of exercises.",
        ],
      },
    ],
    includes: [
      { title: "Structured splits", body: "Upper/lower, push/pull/legs or full body, chosen for the goal, not for fashion." },
      { title: "Written progression", body: "Week-by-week sets, reps and loads so you can see progress on paper." },
      { title: "The creator's method", body: "Why the program is built the way it is, from the person who built it." },
      { title: "Lifetime access", body: "Pay once, keep the plan, and run it again whenever you like." },
    ],
    links: [
      { label: "Muscle building plans", href: "/goal/gain-muscle" },
      { label: "Strength plans", href: "/goal/strength" },
      { label: "Fat loss plans", href: "/goal/lose-fat" },
      { label: "Endurance plans", href: "/goal/endurance" },
    ],
    faq: [
      { q: "What is the best workout split for building muscle?", a: "Any split that trains each muscle group about twice a week with enough total sets will work. Upper/lower and push/pull/legs are popular because they make that easy to schedule." },
      { q: "How long until I see results?", a: "Strength usually improves within the first few weeks as technique and coordination improve. Visible changes in size take longer and depend on training, food and sleep." },
      { q: "Is this a subscription?", a: "No. Every plan is a one-time purchase with lifetime access to the program." },
    ],
  },
  {
    slug: "athlete-workout-program",
    navLabel: "Athlete Workout Programs",
    title: "Athlete Workout Programs: Train Like Pro Athletes",
    description:
      "Athlete workout programs built by the athletes themselves: strength, speed, conditioning and recovery, organised by sport. Lifetime access, no subscription.",
    kicker: "Athlete programs",
    h1: "Athlete workout programs",
    lead:
      "Programs built by competitive athletes and their coaches, covering the strength, speed, conditioning and recovery work behind their performance.",
    sections: [
      {
        heading: "How athletes actually train",
        body: [
          "An athlete's program is not a bodybuilding routine. It is built around the sport: power and speed for explosive sports, repeat efforts for conditioning-heavy ones, and enough strength work to stay durable through a season.",
          "That is why programs here are organised by sport as well as by goal. A football player and a boxer both lift, but for different reasons, in different ways and at different points in their week.",
        ],
      },
      {
        heading: "Who these programs are for",
        body: [
          "Competitive players who want a structured off-season or in-season plan, and everyday lifters who want to train with an athlete's priorities: moving well, staying healthy and performing, not only looking the part.",
          "Every program states its level and equipment needs, so you can tell before buying whether it fits where you are now.",
        ],
      },
    ],
    includes: [
      { title: "Sport-specific structure", body: "Strength, power and conditioning arranged around how the sport is played." },
      { title: "Recovery built in", body: "Mobility, deloads and lighter days are part of the plan, not an afterthought." },
      { title: "From the athlete", body: "The method comes from the person who trains this way, not a generic template." },
      { title: "Clear level and equipment", body: "Know before you buy whether a program fits your experience and setup." },
    ],
    links: [
      { label: "Football", href: "/sport/football" },
      { label: "Basketball", href: "/sport/basketball" },
      { label: "MMA", href: "/sport/mma" },
      { label: "Boxing", href: "/sport/boxing" },
    ],
    faq: [
      { q: "Can a non-athlete follow an athlete program?", a: "Yes, as long as the program's level matches your training experience. Each plan lists its difficulty and what you need to start." },
      { q: "Are these in-season or off-season programs?", a: "It depends on the program. Each plan describes the phase it is built for and how many weeks it runs." },
      { q: "Do the programs include conditioning?", a: "Most athlete programs combine strength, power and conditioning, because that is how athletes train. The program page lists exactly what is included." },
    ],
  },
  {
    slug: "meal-plans-for-muscle-gain",
    navLabel: "Meal Plans for Muscle Gain",
    title: "Meal Plans for Muscle Gain and Fat Loss",
    description:
      "Nutrition and meal plans for muscle gain, fat loss and performance, built to pair with structured training. One-time purchase, lifetime access.",
    kicker: "Nutrition",
    h1: "Meal plans for muscle gain",
    lead:
      "Nutrition plans built to match the training: enough food and protein to grow, structured so it fits a normal week.",
    sections: [
      {
        heading: "Training builds the signal, food builds the muscle",
        body: [
          "Lifting tells your body to build muscle. Food is what it builds it from. Without enough total energy and protein, even a great training plan stalls.",
          "A good meal plan takes the guesswork out of that: how much to eat, how to spread protein across the day, and what a realistic day of meals looks like, not just a list of macros.",
        ],
      },
      {
        heading: "Muscle gain, fat loss or both",
        body: [
          "Gaining muscle usually means eating slightly more than you burn. Losing fat means eating slightly less while keeping protein high so you hold on to the muscle you have. Plans here are labelled by which of those they are built for.",
          "If you have a medical condition, or take medication that affects appetite or blood sugar, talk to your doctor or a registered dietitian before changing how you eat.",
        ],
      },
    ],
    includes: [
      { title: "Daily structure", body: "What a training day and a rest day of eating actually look like." },
      { title: "Protein first", body: "Protein targets and how to hit them without living on shakes." },
      { title: "Built to pair with training", body: "Designed alongside the training plans, not as a separate diet." },
      { title: "Lifetime access", body: "Pay once and keep the plan." },
    ],
    links: [
      { label: "Nutrition plans", href: "/goal/nutrition" },
      { label: "Muscle building plans", href: "/goal/gain-muscle" },
      { label: "Fat loss plans", href: "/goal/lose-fat" },
    ],
    faq: [
      { q: "How much protein do I need to build muscle?", a: "Many athletes and coaches aim for roughly 1.6 to 2.2 grams of protein per kilogram of body weight per day. Your plan sets a target for you." },
      { q: "Can I build muscle and lose fat at the same time?", a: "It is possible, especially for beginners or people returning to training, but most people make faster progress by focusing on one goal at a time." },
      { q: "Is this medical advice?", a: "No. These are training and nutrition programs for healthy adults. Speak to a doctor or registered dietitian about any medical condition." },
    ],
  },
  {
    slug: "hyrox-training-plan",
    navLabel: "Hyrox Training Plan",
    title: "Hyrox Training Plan: Running, Strength and Station Work",
    description:
      "Hyrox training plans that combine running, strength and station work in structured weeks, for first races and faster finishes. Lifetime access.",
    kicker: "Hybrid training",
    h1: "Hyrox training plan",
    lead:
      "Hybrid programs that build the running engine and the strength to move sleds, wall balls and lunges without falling apart in the second half.",
    sections: [
      {
        heading: "What Hyrox asks of you",
        body: [
          "A Hyrox race alternates eight 1 km runs with eight functional stations: SkiErg, sled push, sled pull, burpee broad jumps, rowing, farmers carry, sandbag lunges and wall balls. It rewards people who can keep running well while their legs and grip are tired.",
          "That means a plan has to train both sides at once: aerobic running fitness, and strength-endurance on the stations, then put them together under fatigue.",
        ],
      },
      {
        heading: "First race or faster time",
        body: [
          "For a first race, the goal is to finish strong: build running volume gradually, learn efficient technique on every station and practise transitions. For a faster time, the focus moves to pacing, compromised running and heavier station work.",
          "Look for a plan that tells you which of those it is built for, how many weeks it runs and how many days a week it needs.",
        ],
      },
    ],
    includes: [
      { title: "Running and strength together", body: "Weekly structure that develops both without one wrecking the other." },
      { title: "Station technique", body: "Efficient movement on every station saves more time than fitness alone." },
      { title: "Race simulation", body: "Compromised runs and station combos so race day is not the first time." },
      { title: "Lifetime access", body: "Keep the plan for your next race too." },
    ],
    links: [
      { label: "Endurance plans", href: "/goal/endurance" },
      { label: "Strength plans", href: "/goal/strength" },
      { label: "Beginner-friendly plans", href: "/goal/beginner-friendly" },
    ],
    faq: [
      { q: "How long should I train for my first Hyrox?", a: "Many first-timers use an 8 to 12 week block. It depends on your current running and strength base." },
      { q: "Do I need a Hyrox gym to train?", a: "Access to a sled, rower and SkiErg helps, but plans can substitute stations with common gym equipment where needed." },
      { q: "Is Hyrox good for beginners?", a: "Yes. The open division is designed for everyday fitness enthusiasts, and a structured plan makes the first race far more enjoyable." },
    ],
  },
  {
    slug: "glp-1-workout-plan",
    navLabel: "GLP-1 Workout Plan",
    title: "GLP-1 Workout Plan: Strength Training to Protect Muscle",
    description:
      "Strength-focused workout plans for people losing weight on GLP-1 medication, built to help keep muscle while the scale moves. Check with your doctor first.",
    kicker: "Strength for weight loss",
    h1: "Workout plan for GLP-1 users",
    lead:
      "When weight comes off quickly, what you keep matters as much as what you lose. Strength training is how you hold on to muscle.",
    sections: [
      {
        heading: "Why strength training matters during weight loss",
        body: [
          "Any significant weight loss can include muscle as well as fat. Keeping muscle helps you stay strong, move well and look the way you hoped when the scale started moving.",
          "Regular strength training and enough protein are the two levers most people can control. A structured plan makes the training part simple: a few sessions a week, progressive, and realistic about energy levels that may be lower than usual.",
        ],
      },
      {
        heading: "Start where you are",
        body: [
          "If you are new to lifting, choose a beginner-friendly plan that starts with lighter loads and teaches the basic movements. Short, consistent sessions beat long ones you cannot recover from.",
          "Always talk to your prescribing doctor before starting a new exercise or nutrition program while on medication. These plans are fitness programs, not medical treatment.",
        ],
      },
    ],
    includes: [
      { title: "Strength first", body: "Two to four lifting sessions a week focused on the big muscle groups." },
      { title: "Realistic sessions", body: "Built for lower appetite and energy, not for an athlete's recovery." },
      { title: "Protein guidance", body: "Pair with a nutrition plan that keeps protein high." },
      { title: "Lifetime access", body: "Pay once and keep the plan as you progress." },
    ],
    links: [
      { label: "Beginner-friendly plans", href: "/goal/beginner-friendly" },
      { label: "Strength plans", href: "/goal/strength" },
      { label: "Nutrition plans", href: "/goal/nutrition" },
      { label: "Fat loss plans", href: "/goal/lose-fat" },
    ],
    faq: [
      { q: "Should I exercise while taking a GLP-1 medication?", a: "Many doctors encourage strength training during weight loss to help preserve muscle. Ask your prescribing doctor what is right for you before starting." },
      { q: "How often should I lift?", a: "Two to four sessions a week is a common, sustainable starting point. A beginner plan will set the exact schedule." },
      { q: "Is this plan medical advice?", a: "No. It is a training program for adults cleared to exercise. It does not replace advice from your doctor." },
    ],
  },
  {
    slug: "mobility-routine-for-athletes",
    navLabel: "Mobility Routines",
    title: "Mobility Routine for Athletes and Lifters",
    description:
      "Mobility and flexibility routines for athletes and lifters: hips, shoulders and spine, built to support training and recovery. Lifetime access.",
    kicker: "Mobility and recovery",
    h1: "Mobility routines for athletes and lifters",
    lead:
      "Short, structured mobility work for the joints that limit training most: hips, ankles, shoulders and upper back.",
    sections: [
      {
        heading: "Mobility is not stretching for its own sake",
        body: [
          "Good mobility means you can get into the positions your training and sport need, with control. A deep squat, an overhead press, a full sprint stride: each needs range of motion you can actually use under load.",
          "A mobility routine targets the specific joints that limit those positions, and it is short enough to do before training or on rest days without becoming a second workout.",
        ],
      },
      {
        heading: "For athletes, lifters and desk-bound days",
        body: [
          "Athletes use mobility work to stay durable through a season. Lifters use it to hit better positions in the big lifts. And anyone who sits most of the day benefits from opening hips and upper back regularly.",
          "Pick a routine by where you feel restricted and how much time you have; ten focused minutes done consistently beats an hour once a month.",
        ],
      },
    ],
    includes: [
      { title: "Joint-by-joint focus", body: "Hips, ankles, thoracic spine and shoulders, the usual limiters." },
      { title: "Fits around training", body: "Warm-up and rest-day versions that do not add fatigue." },
      { title: "Progressions", body: "From assisted positions to loaded end-range strength." },
      { title: "Lifetime access", body: "Keep the routine and come back to it any time." },
    ],
    links: [
      { label: "Mobility plans", href: "/goal/mobility" },
      { label: "Beginner-friendly plans", href: "/goal/beginner-friendly" },
      { label: "Strength plans", href: "/goal/strength" },
    ],
    faq: [
      { q: "How often should I do mobility work?", a: "Short sessions most days work better than long sessions occasionally. Many routines take ten to fifteen minutes." },
      { q: "Should I stretch before lifting?", a: "A short dynamic mobility routine is a good warm-up. Save longer static holds for after training or rest days." },
      { q: "Is mobility the same as flexibility?", a: "Not quite. Flexibility is how far a joint can move; mobility is how much of that range you can control and use." },
    ],
  },
];

const BY_SLUG = new Map(PLANS.map((p) => [p.slug, p]));

function getPlanGuide(slug) {
  return BY_SLUG.get(slug) || null;
}

function listPlanGuides() {
  return PLANS;
}

module.exports = { getPlanGuide, listPlanGuides };
