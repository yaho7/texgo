export interface ReleasePolicy { version: string; tag: string; publish: boolean; prerelease: boolean; latest: boolean }
export function releasePolicy(version: string, ref?: string): ReleasePolicy;
export function desktopBuildIdentity(version: string, ref?: string): string;
export function checkVersions(root?: string, ref?: string): Promise<ReleasePolicy>;
export function writeGithubOutputs(policy: ReleasePolicy, destination: string): Promise<void>;
