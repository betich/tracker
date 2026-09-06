/**
 * Everything a deployment might want to change, in one place.
 *
 * This is the only file you need to edit after cloning. It is read at build
 * time, so a change needs a rebuild — the tracked subject and the contact
 * details are baked into the pages, not fetched.
 */

export interface TrackerConfig {
  /**
   * What is being tracked. Shown in the header, used as the map marker's label,
   * and used to namespace this deployment's data in the browser.
   *
   * Changing it does NOT move the server-side timeline — that follows
   * TRACKER_ID in wrangler.jsonc.
   */
  subject: string;

  /**
   * The buttons fixed to the bottom right of every tab. Set either to null to
   * hide that button; set both to null and the pair disappears entirely.
   */
  contacts: {
    /** Dialled by the phone button, in full international form. */
    phone: string | null;
    /** Shown and copied by the LINE button, for "add by phone number". */
    lineId: string | null;
  };

  /** Whether the draggable portrait sits in the footer. */
  portrait: boolean;

  /** Where the map opens before anyone's position is known. */
  mapFallbackCenter: { lat: number; lon: number };
}

export const config: TrackerConfig = {
  subject: "bundit",

  contacts: {
    phone: "+66863862633",
    lineId: "0863862633",
  },

  portrait: true,

  // Bangkok.
  mapFallbackCenter: { lat: 13.7563, lon: 100.5018 },
};

/** Storage keys are namespaced per subject so two trackers don't share likes. */
export const storagePrefix = config.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-");
