import { describe, expect, it } from "vitest";

import jobCompleted from "../../../../rocketride/samples/events/job_completed.sample.json";
import jobDisputed from "../../../../rocketride/samples/events/job_disputed.sample.json";
import lateDelivery from "../../../../rocketride/samples/events/late_delivery.sample.json";
import refundIssued from "../../../../rocketride/samples/events/refund_issued.sample.json";
import repeatHire from "../../../../rocketride/samples/events/repeat_hire.sample.json";
import type { RawMarketplaceEvent } from "../../../types/rocketride";
import { mapEvent } from "../mapEvent";
import { validateTrustEvent } from "../validate";

const CASES: Array<{ event: RawMarketplaceEvent; edge_type: string; outcome: string }> = [
  { event: jobCompleted as RawMarketplaceEvent, edge_type: "CONFIRMED_BY", outcome: "passed" },
  { event: jobDisputed as RawMarketplaceEvent, edge_type: "DISPUTED_BY", outcome: "disputed" },
  { event: refundIssued as RawMarketplaceEvent, edge_type: "PARTIAL_REFUND", outcome: "partial" },
  { event: repeatHire as RawMarketplaceEvent, edge_type: "REPEAT_HIRE", outcome: "passed" },
  { event: lateDelivery as RawMarketplaceEvent, edge_type: "DELIVERED_LATE", outcome: "partial" },
];

describe("mapEvent", () => {
  it.each(CASES)("maps $event.event_type to $edge_type / $outcome and passes the contract", ({ event, edge_type, outcome }) => {
    const [trustEvent] = mapEvent(event);

    expect(trustEvent.edge_type).toBe(edge_type);
    expect(trustEvent.outcome).toBe(outcome);

    const result = validateTrustEvent(trustEvent);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("redacts PII from dispute text but keeps enough context to classify", () => {
    const [trustEvent] = mapEvent(jobDisputed as RawMarketplaceEvent);

    expect(trustEvent.reason).not.toContain("jane.buyer@example.com");
    expect(trustEvent.reason).toContain("43 documents");
    expect(trustEvent.additional_context.anonymized).toBe(true);
  });

  it("derives dispute_status from arbitration_outcome for disputed jobs", () => {
    const [disputed] = mapEvent(jobDisputed as RawMarketplaceEvent);
    expect(disputed.dispute_status).toBe("open");

    const [refunded] = mapEvent(refundIssued as RawMarketplaceEvent);
    expect(refunded.dispute_status).toBe("resolved");
    expect(refunded.arbitration_outcome).toBe("split");
  });

  it("throws on an unsupported event_type instead of guessing an enum", () => {
    const bogus: RawMarketplaceEvent = {
      event_id: "e1",
      event_type: "not_a_real_event",
      occurred_at: "2026-07-13T00:00:00Z",
      payload: {},
    };
    expect(() => mapEvent(bogus)).toThrow(/unsupported event_type/);
  });
});
