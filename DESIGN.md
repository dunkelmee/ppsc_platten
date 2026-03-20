# Design System Document

## 1. Overview & Creative North Star: "Kinetic Brutalism"


This design system is engineered to capture the friction, speed, and social electricity of table tennis. Moving away from static, "app-template" layouts, we embrace **Kinetic Brutalism**. This philosophy combines high-impact editorial typography with a physical sense of layering.


The system breaks the "boring grid" by utilizing intentional asymmetry—where elements might bleed off-screen or overlap—mirroring the unpredictable bounce of a ball. We treat the interface not as a flat screen, but as a digital social club: vibrant, textured, and unapologetically premium.


## 2. Colors: Tonal Depth & Rubber Vibrancy

Our palette balances high-energy "rubber" tones with sophisticated neutrals to ensure the UI feels energetic but never "cheap."


### The Palette

* **Primary (`#a90096`):** The signature "Electric Pink." Use this for high-impact brand moments and key calls to action.
* **Secondary (`#605e5e`):** A deep, industrial grey that provides grounding.
* **Tertiary (`#006a3d`):** A lush, court-inspired green used for success states and "Beginner" badges.
* **Surface Hierarchy:** We utilize `surface-container-lowest` (`#ffffff`) through `surface-container-highest` (`#e6e1e1`) to define importance.

### The "No-Line" Rule

**Prohibit 1px solid borders for sectioning.** Boundaries must be defined solely through background color shifts. For example, a `surface-container-low` section should sit directly against a `surface` background. This creates a high-end, editorial flow rather than a boxed-in "web form" feel.


### Glass & Gradient Signature

To move beyond a standard digital feel, use **Glassmorphism** for floating elements (e.g., navigation bars or player stats overlays). Apply a semi-transparent surface color with a `backdrop-blur`.

* **CTA Soul:** Main buttons should use a subtle linear gradient from `primary` (`#a90096`) to `primary-container` (`#d400bc`) to provide a tactile, rubber-like depth.


## 3. Typography: Editorial Authority

We use a high-contrast pairing to distinguish between "The Brand" and "The Content."


* **Display & Headlines (Space Grotesk):** This is our "loud" voice. It’s geometric and modern. Use `display-lg` (3.5rem) for hero statements with tight letter-spacing to create a bold, "poster" aesthetic.
* **Body & Titles (Manrope):** A clean, highly legible sans-serif. Use `body-lg` (1rem) for player bios and match descriptions to ensure readability against vibrant backgrounds.
* **The Courier Influence:** Referencing the brand's roots, use a monospaced font sparingly for "technical" data points (match times, scores, and skill levels) to evoke the feeling of a vintage scoreboard.


## 4. Elevation & Depth: The Layering Principle

Hierarchy is achieved through **Tonal Layering** rather than traditional structural lines.

* **Nesting:** Depth is achieved by "stacking" surface-container tiers. Place a `surface-container-lowest` card on a `surface-container-low` section to create a soft, natural lift.
* **Ambient Shadows:** For "floating" components like match-invite modals, use extra-diffused shadows (Blur: 24px-40px) at a low 6% opacity. Use a tinted version of `on-surface` (dark grey/purple) instead of pure black to mimic natural light.
* **The "Ghost Border" Fallback:** If a border is essential for accessibility, use the `outline-variant` token at **20% opacity**. Never use 100% opaque borders.
* **Backdrop Blurs:** Use `surface-variant` with a 70% alpha and 12px blur for headers, allowing the vibrant "Electric Pink" or "Court Green" colors of the content to bleed through as the user scrolls.


## 5. Components: Custom & Intentional

### Skill Level Badges (Signature Component)

These are not standard tags; they are "status symbols." Use `full` roundedness and `label-md` typography.

* **Beginner:** `tertiary` (`#006a3d`) background / `on-tertiary` text.
* **Intermediate:** Amber (Custom: `#FFBF00`) / `on-background` text.
* **Advanced:** `error` (`#ba1a1a`) / `on-error` text.
### Buttons

* **Primary:** Gradient of `primary` to `primary-container`, `md` (0.75rem) roundedness, `title-sm` typography.
* **Tertiary (Ghost):** No background, no border. Use `primary` text color. High-end apps rely on typography, not boxes.
### Cards & Lists

* **The "No Divider" Rule:** Forbid the use of divider lines. Separate list items using `spacing-4` (1rem) of vertical white space or a 1-step shift in the `surface-container` scale.
* **Visual Interest:** In cards, use the provided logo mascot as a subtle, low-opacity background watermark to break the clean lines with its organic, playful shape.
### Inputs

* **Interaction:** On focus, shift the background from `surface-container` to `surface-container-lowest` and apply a `primary` "Ghost Border" (20% opacity). Do not change the border thickness.


## 6. Do’s and Don’ts

### Do:

* **Embrace Asymmetry:** Offset a headline so it hangs over a container edge. It feels more "club" and less "corporate."
* **Use Mono for Data:** Use monospaced type for match scores (e.g., 21-19) to give it a scoreboard aesthetic.
* **Prioritize Thumb-Zone:** Since this is mobile-first, place all primary actions (Create Match, Join Club) within the bottom 30% of the screen.
### Don’t:

* **Don't use 1px lines:** They clutter the UI and make the design feel dated. Let color transitions do the work.
* **Don't crowd the Logo:** The mascot logo has a lot of personality; give it `spacing-10` (2.5rem) of clear space so it doesn't feel suffocated.
* **Don't use standard Grey shadows:** Always tint your shadows with the primary brand color to maintain the "Social Club" warmth.