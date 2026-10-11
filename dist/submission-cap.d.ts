/**
 * Per-process cap on Indexing API and sitemap submissions.
 * The counter lives in this process only and resets when the process exits.
 */
export declare function getMaxUrlSubmits(): number;
export declare function getSubmissionCount(): number;
export declare function resetSubmissionCountForTests(): void;
/**
 * Reserve `count` submission slots. Throws, without incrementing, when the
 * reservation would pass the cap, so a rejected batch does not consume quota
 * and does not reach the network.
 */
export declare function reserveUrlSubmits(count: number): void;
