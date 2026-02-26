"use strict";

/**
 * Lightweight in-process queue for inspection analysis jobs.
 * Suitable for dev/single-instance. Can be upgraded to BullMQ/Redis later.
 */

const { runAnalysis } = require("./inspectionAnalysisService");

const queue = [];
let processing = false;

async function processNext() {
  if (processing || queue.length === 0) return;
  processing = true;
  const jobId = queue.shift();
  try {
    await runAnalysis(jobId);
  } catch (err) {
    console.error("[inspectionAnalysisQueue] Job failed:", jobId, err);
  } finally {
    processing = false;
    if (queue.length > 0) {
      setImmediate(processNext);
    }
  }
}

function enqueue(jobId) {
  queue.push(jobId);
  setImmediate(processNext);
}

module.exports = { enqueue };
