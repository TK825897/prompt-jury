import type { ProviderId } from "../adapters/types";
import type { ResponseDocument } from "../storage/types";
import type { AnonymousAnswer } from "./prompts";

export interface AnonymousCandidateSet {
  answers: AnonymousAnswer[];
  mapping: Record<string, ProviderId>;
}

export function anonymizeResponses(responses: ResponseDocument[], random: () => number = Math.random): AnonymousCandidateSet {
  const shuffled = [...responses];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  const mapping: Record<string, ProviderId> = {};
  const answers = shuffled.map((response, index) => {
    const answerId = `Answer ${String.fromCharCode(65 + index)}`;
    mapping[answerId] = response.providerId;
    return { answerId, text: response.text };
  });
  return { answers, mapping };
}
