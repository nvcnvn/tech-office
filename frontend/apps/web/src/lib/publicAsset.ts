const releaseTag = process.env.NEXT_PUBLIC_RELEASE_TAG?.trim();

export function versionedPublicAssetPath(path: string): string {
	if (!releaseTag) {
		return path;
	}

	const separator = path.includes("?") ? "&" : "?";
	return `${path}${separator}v=${encodeURIComponent(releaseTag)}`;
}