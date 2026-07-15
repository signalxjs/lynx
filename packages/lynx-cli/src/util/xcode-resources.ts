/**
 * Structural checks for folder references in an Xcode project's Resources
 * build phase — shared by `prebuild` (which registers/repairs them) and
 * `embed-bundle` (which refuses to embed into a project that wouldn't ship
 * the files).
 *
 * A folder is only really embedded when THREE entries line up: a
 * PBXFileReference of type `folder`, a PBXBuildFile pointing at it, and that
 * build file listed in the Resources phase. Substring-matching the folder
 * name can't tell a complete registration from a partial one — and a partial
 * one is the dangerous case: everything looks wired, Xcode ships nothing, and
 * the failure only surfaces at runtime in a release build (#599).
 *
 * Deliberately UUID-agnostic: scaffolded projects carry the template's
 * hard-coded ids while retrofitted ones get deterministic generated ids.
 */

export interface ResourceFolderRegistration {
    /** `<uuid> /* Name *\/ = {isa = PBXFileReference; ... path = Name; }` */
    hasFileReference: boolean;
    /** `<uuid> /* Name in Resources *\/ = {isa = PBXBuildFile; ... }` */
    hasBuildFile: boolean;
    /** The build file's uuid is listed in the PBXResourcesBuildPhase files. */
    inResourcesPhase: boolean;
}

/** Inspect how (and whether) `folderName` is registered as a bundled resource. */
export function resourceFolderRegistration(
    pbxproj: string,
    folderName: string,
): ResourceFolderRegistration {
    const hasFileReference = new RegExp(
        `/\\* ${folderName} \\*/ = \\{isa = PBXFileReference;[^}]*path = ${folderName};`,
    ).test(pbxproj);

    // Ids are 16 hex chars in our scaffolded template, 24 in projects Xcode
    // has rewritten, and 24 for the ones the injector generates — so match on
    // shape, not length.
    const buildFile = new RegExp(
        `([A-Za-z0-9]{16,32}) /\\* ${folderName} in Resources \\*/ = \\{isa = PBXBuildFile;`,
    ).exec(pbxproj);

    let inResourcesPhase = false;
    if (buildFile) {
        // Anchor on the Resources phase so a Sources/Frameworks entry can't
        // masquerade as one.
        const phase = /isa = PBXResourcesBuildPhase;[\s\S]*?\n\s*\);/.exec(pbxproj);
        inResourcesPhase = !!phase
            && phase[0].includes(`${buildFile[1]} /* ${folderName} in Resources */`);
    }

    return { hasFileReference, hasBuildFile: !!buildFile, inResourcesPhase };
}

/** True only when the folder would actually be copied into the built app. */
export function isResourceFolderRegistered(pbxproj: string, folderName: string): boolean {
    const r = resourceFolderRegistration(pbxproj, folderName);
    return r.hasFileReference && r.hasBuildFile && r.inResourcesPhase;
}

/**
 * Drop every line mentioning `folderName`, so a partial registration can be
 * re-injected from scratch rather than half-repaired. Each pbxproj entry lives
 * on its own line, so this is safe and keeps the injector to one code path.
 */
export function stripResourceFolderEntries(pbxproj: string, folderName: string): string {
    return pbxproj
        .split('\n')
        .filter((line) =>
            !line.includes(`/* ${folderName} */`)
            && !line.includes(`/* ${folderName} in Resources */`))
        .join('\n');
}
