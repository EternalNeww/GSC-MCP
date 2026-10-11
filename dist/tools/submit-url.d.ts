interface SubmitResult {
    url: string;
    type: "URL_UPDATED";
    notifyTime: string | null;
    success: boolean;
    error: string | null;
    note: string;
}
export declare function submitUrl(url: string): Promise<SubmitResult>;
export declare function submitBatch(urls: string[]): Promise<{
    results: SubmitResult[];
    summary: {
        total: number;
        succeeded: number;
        failed: number;
        note: string;
    };
}>;
export {};
