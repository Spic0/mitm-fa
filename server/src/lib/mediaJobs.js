// A single-consumer background queue for expensive media work.
//
// Converting one 15.5MB handbook GIF to an animated WebP costs ~1.5s of pure
// CPU in sharp. Six of them, run inline in their upload requests, is ~9s of a
// SINGLE-process Node server not answering anything else — which is precisely
// the "uploads degrade the whole platform" symptom. The upload response does
// not need the derivative, so it should never wait for it.
//
// Deliberately in-process and dependency-free, matching how the two scheduled
// sweeps in src/index.js already work. This is one pm2 fork with no Redis and
// no job runner; adding either to get a work queue would be a bigger change
// than the problem justifies. The trade-offs that buys, stated plainly:
//
//   - a queued job is lost if the process restarts before it runs. That is
//     survivable here because every job is REGENERABLE from the original file,
//     which is already safely on disk — tools/backfill-animated-media.js
//     re-derives anything missing, and the read path falls back to the
//     original meanwhile. Nothing a customer paid for is at risk.
//   - concurrency is 1 on purpose. sharp releases the event loop, but it still
//     burns a core per conversion; letting six run at once on a 6-core box
//     starves request handling just as badly as doing it inline.
//
// If this ever runs behind more than one process, this queue becomes per
// process — which is still correct, just less efficient (both would derive the
// same file). Move to a shared queue at that point, not before.

const queue = [];
let running = false;
let processed = 0;
let failed = 0;

async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift();
    const started = Date.now();
    try {
      await job.run();
      processed++;
      console.log(`[mediaJobs] ${job.label} done in ${Date.now() - started}ms (${queue.length} queued)`);
    } catch (err) {
      failed++;
      // A failed derivative is a performance regression for one file, never a
      // correctness problem: the read path falls back to the original.
      console.error(`[mediaJobs] ${job.label} FAILED after ${Date.now() - started}ms:`, err.message);
    }
  }
  running = false;
}

// Fire-and-forget. Returns immediately; the caller must not await the work.
function enqueue(label, run) {
  queue.push({ label, run });
  // setImmediate so the enqueuing request finishes its response first — the
  // whole point is that the upload does not wait behind the conversion.
  setImmediate(() => { drain().catch((err) => console.error("[mediaJobs] drain crashed:", err)); });
}

function stats() {
  return { queued: queue.length, running, processed, failed };
}

module.exports = { enqueue, stats };
