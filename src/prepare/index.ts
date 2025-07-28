/**
 * Main prepare module that routes to appropriate prepare logic based on event type
 */

import type { PrepareOptions, PrepareResult } from "./types";
import { prepareEntityEvent } from "./entity-events";
import { prepareAutomationEvent } from "./automation-events";

const AUTOMATION_EVENTS = ["workflow_dispatch", "schedule"];

export async function prepare(options: PrepareOptions): Promise<PrepareResult> {
  const { context } = options;

  if (AUTOMATION_EVENTS.includes(context.eventName)) {
    console.log(`Preparing automation event: ${context.eventName}`);
    return prepareAutomationEvent(options);
  }

  console.log(`Preparing entity-based event: ${context.eventName}`);
  return prepareEntityEvent(options);
}
