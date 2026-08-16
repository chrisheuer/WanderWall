/**
 * Creative Commons support. CC is legal signaling, not DRM — no right-click
 * blocking or similar theater anywhere in the product.
 */

export type License =
  | "all-rights-reserved"
  | "cc-by"
  | "cc-by-sa"
  | "cc-by-nc"
  | "cc-by-nc-sa"
  | "cc-by-nd"
  | "cc-by-nc-nd"
  | "cc0";

export interface LicenseInfo {
  id: License;
  label: string;
  badge: string;
  /** Canonical deed URL; null for all-rights-reserved. */
  deedUrl: string | null;
  /** schema.org `license` value; null means omit the property. */
  schemaUrl: string | null;
}

export const LICENSES: Record<License, LicenseInfo> = {
  "all-rights-reserved": {
    id: "all-rights-reserved",
    label: "All rights reserved",
    badge: "©",
    deedUrl: null,
    schemaUrl: null,
  },
  "cc-by": {
    id: "cc-by",
    label: "CC BY 4.0",
    badge: "CC BY",
    deedUrl: "https://creativecommons.org/licenses/by/4.0/",
    schemaUrl: "https://creativecommons.org/licenses/by/4.0/",
  },
  "cc-by-sa": {
    id: "cc-by-sa",
    label: "CC BY-SA 4.0",
    badge: "CC BY-SA",
    deedUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    schemaUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  },
  "cc-by-nc": {
    id: "cc-by-nc",
    label: "CC BY-NC 4.0",
    badge: "CC BY-NC",
    deedUrl: "https://creativecommons.org/licenses/by-nc/4.0/",
    schemaUrl: "https://creativecommons.org/licenses/by-nc/4.0/",
  },
  "cc-by-nc-sa": {
    id: "cc-by-nc-sa",
    label: "CC BY-NC-SA 4.0",
    badge: "CC BY-NC-SA",
    deedUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    schemaUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  },
  "cc-by-nd": {
    id: "cc-by-nd",
    label: "CC BY-ND 4.0",
    badge: "CC BY-ND",
    deedUrl: "https://creativecommons.org/licenses/by-nd/4.0/",
    schemaUrl: "https://creativecommons.org/licenses/by-nd/4.0/",
  },
  "cc-by-nc-nd": {
    id: "cc-by-nc-nd",
    label: "CC BY-NC-ND 4.0",
    badge: "CC BY-NC-ND",
    deedUrl: "https://creativecommons.org/licenses/by-nc-nd/4.0/",
    schemaUrl: "https://creativecommons.org/licenses/by-nc-nd/4.0/",
  },
  cc0: {
    id: "cc0",
    label: "CC0 1.0 (Public Domain Dedication)",
    badge: "CC0",
    deedUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    schemaUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
};

/** Never default anyone into CC — opt-in only. */
export const DEFAULT_LICENSE: License = "all-rights-reserved";

export function effectiveLicense(
  galleryDefault: License,
  artworkOverride: License | null | undefined,
): LicenseInfo {
  return LICENSES[artworkOverride ?? galleryDefault];
}

export function licenseDisplay(info: LicenseInfo, creatorName: string): string {
  return info.deedUrl ? info.badge : `© ${creatorName}`;
}
