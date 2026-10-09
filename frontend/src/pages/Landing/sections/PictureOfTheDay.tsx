import type { ReactElement } from 'react'
import { PICTURES_OF_THE_DAY, type PictureOfTheDay as PictureName } from '../../../lib/pictureOfTheDay'
import styles from './PictureOfTheDay.module.css'

/**
 * The hero's picture of the day (owner, 2026-10-09: "a positive and motivational one … updated
 * regularly"): seven drawn pictures — a summit reached, a book that grows, a bright idea, a rocket,
 * the steps to a trophy, a sunrise and a target hit — one a day.
 *
 * **All seven are in the page and CSS shows today's**, which `public/boot.js` names before the
 * first paint (`<html data-picture>`, from the India date). The homepage is drawn at build time for
 * everybody and React renders over it, so a choice made here would draw one picture and swap to
 * another when the app took over; with the attribute, the drawn page and the app agree from the
 * start. Seven small inline drawings cost less than one photograph, ask the network for nothing,
 * and take their colours from the theme (`--art-*` in `tokens.css`) — a night version during the
 * Diwali edition.
 *
 * Decoration: hidden from assistive technology, like the doodles around it. The words that
 * matter are the headline's.
 */
export default function PictureOfTheDay() {
  return (
    <div className={styles.frame} aria-hidden="true">
      {PICTURES_OF_THE_DAY.map((name, index) => {
        const Drawing = DRAWINGS[name]
        return (
          <svg key={name} className={styles.scene} data-index={index} viewBox="0 0 240 240" focusable="false">
            <Sky id={`potd-${name}`} />
            <Drawing />
          </svg>
        )
      })}
    </div>
  )
}

/** The shared sky: a gradient from the top colour to the horizon's. */
function Sky({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className={styles.skyTop} />
          <stop offset="1" className={styles.skyBottom} />
        </linearGradient>
      </defs>
      <rect width="240" height="240" fill={`url(#${id})`} />
    </>
  )
}

/** A four-pointed sparkle centred on (x, y). */
function Sparkle({ x, y, size = 1 }: { x: number; y: number; size?: number }) {
  const s = 8 * size
  const w = 2.6 * size
  return <path className={styles.sparkle} d={`M${x} ${y - s} L${x + w} ${y - w} L${x + s} ${y} L${x + w} ${y + w} L${x} ${y + s} L${x - w} ${y + w} L${x - s} ${y} L${x - w} ${y - w} Z`} />
}

/** A summit reached: the path up, the flag at the top, the sun beyond. */
function Summit() {
  return (
    <>
      <circle className={styles.glow} cx="180" cy="62" r="34" />
      <circle className={styles.sun} cx="180" cy="62" r="20" />
      <path className={styles.hillFar} d="M0 178 L44 132 L76 158 L122 108 L168 152 L204 122 L240 150 V240 H0 Z" />
      <path className={styles.hill} d="M26 240 L120 90 L214 240 Z" />
      <path className={styles.paper} d="M120 90 L102 120 L113 114 L121 124 L130 113 L139 120 Z" />
      <path className={styles.trail} d="M70 232 L104 210 L86 190 L117 168 L103 148 L119 126" />
      <path className={styles.line} d="M120 90 V56" />
      <path className={styles.coral} d="M121 56 L150 65 L121 75 Z" />
      <Sparkle x={160} y={98} />
      <Sparkle x={86} y={72} size={0.6} />
      <Sparkle x={204} y={104} size={0.5} />
    </>
  )
}

/** A book that grows: an open book with a sprout reaching up out of it. */
function Growth() {
  return (
    <>
      <circle className={styles.glow} cx="58" cy="56" r="28" />
      <circle className={styles.sun} cx="58" cy="56" r="15" />
      <ellipse className={styles.hill} cx="120" cy="226" rx="118" ry="28" />
      <path className={`${styles.paper} ${styles.outline}`} d="M120 198 C100 186 72 184 44 190 V128 C72 122 100 124 120 138 Z" />
      <path className={`${styles.paper} ${styles.outline}`} d="M120 198 C140 186 168 184 196 190 V128 C168 122 140 124 120 138 Z" />
      <path className={styles.pageLine} d="M56 148 C76 143 96 145 110 152 M56 162 C76 157 96 159 110 166 M56 176 C76 171 96 173 110 180" />
      <path className={styles.pageLine} d="M130 152 C144 145 164 143 184 148 M130 166 C144 159 164 157 184 162 M130 180 C144 173 164 171 184 176" />
      <path className={styles.stem} d="M120 138 C119 116 117 96 121 72" />
      <path className={styles.green} d="M120 108 C102 106 86 94 84 74 C104 74 118 87 120 108 Z" />
      <path className={styles.green} d="M121 92 C138 86 152 70 152 50 C133 52 121 67 121 92 Z" />
      <Sparkle x={168} y={102} />
      <Sparkle x={74} y={112} size={0.6} />
      <Sparkle x={190} y={60} size={0.5} />
    </>
  )
}

/** A bright idea: a lit bulb and its rays. */
function Idea() {
  return (
    <>
      <circle className={styles.glow} cx="120" cy="100" r="74" />
      <path
        className={styles.ray}
        d="M120 16 V34 M180 40 L167 53 M206 100 H188 M60 40 L73 53 M34 100 H52 M180 160 L167 147 M60 160 L73 147"
      />
      <path
        className={`${styles.sun} ${styles.outline}`}
        d="M120 52 C92 52 74 72 74 98 C74 116 84 128 94 138 C100 144 102 150 102 158 H138 C138 150 140 144 146 138 C156 128 166 116 166 98 C166 72 148 52 120 52 Z"
      />
      <path className={styles.filament} d="M108 140 V118 L114 110 L120 118 L126 110 L132 118 V140" />
      <rect className={styles.metal} x="100" y="160" width="40" height="10" rx="3" />
      <rect className={styles.metal} x="102" y="172" width="36" height="10" rx="3" />
      <rect className={styles.lineFill} x="108" y="184" width="24" height="9" rx="4.5" />
      <ellipse className={styles.shadow} cx="120" cy="214" rx="40" ry="6" />
      <Sparkle x={58} y={186} size={0.7} />
      <Sparkle x={186} y={190} size={0.5} />
    </>
  )
}

/** Aiming high: a rocket climbing away from the clouds. */
function Rocket() {
  return (
    <>
      <circle className={styles.star} cx="40" cy="44" r="2.5" />
      <circle className={styles.star} cx="88" cy="26" r="2" />
      <circle className={styles.star} cx="204" cy="34" r="2.5" />
      <circle className={styles.star} cx="214" cy="120" r="2" />
      <circle className={styles.star} cx="30" cy="120" r="2" />
      <path className={styles.trail} d="M26 214 C62 204 96 178 118 146" />
      <g transform="rotate(38 150 100)">
        <path className={styles.sun} d="M136 132 C136 152 150 172 150 172 C150 172 164 152 164 132 Z" />
        <path className={styles.coral} d="M142 132 C142 146 150 160 150 160 C150 160 158 146 158 132 Z" />
        <path className={`${styles.paper} ${styles.outline}`} d="M150 40 C170 60 174 92 168 132 H132 C126 92 130 60 150 40 Z" />
        <circle className={`${styles.blue} ${styles.outline}`} cx="150" cy="82" r="12" />
        <path className={`${styles.coral} ${styles.outline}`} d="M133 112 L114 140 L134 136 Z" />
        <path className={`${styles.coral} ${styles.outline}`} d="M167 112 L186 140 L166 136 Z" />
      </g>
      <path className={styles.paper} d="M0 224 C8 206 34 204 44 214 C52 198 82 200 88 218 C100 208 124 214 124 232 V240 H0 Z" />
      <path className={styles.paper} d="M150 240 C150 222 170 214 184 222 C192 206 222 206 228 222 C236 220 240 222 240 222 V240 Z" />
      <Sparkle x={196} y={74} size={0.6} />
    </>
  )
}

/**
 * Step by step: four steps up to a trophy. Drawn climbing to the right and mirrored, so the trophy
 * stands on the left — the hero's handwritten "Think Solve Grow" covers the top-right corner.
 */
function Stairs() {
  return (
    <g transform="matrix(-1 0 0 1 240 0)">
      <ellipse className={styles.hill} cx="120" cy="226" rx="118" ry="24" />
      <rect className={styles.blue} x="30" y="176" width="46" height="44" rx="6" />
      <rect className={styles.green} x="76" y="146" width="46" height="74" rx="6" />
      <rect className={styles.purple} x="122" y="116" width="46" height="104" rx="6" />
      <rect className={styles.coral} x="168" y="86" width="46" height="134" rx="6" />
      <path className={styles.stepEdge} d="M36 182 H70 M82 152 H116 M128 122 H162 M174 92 H208" />
      <path className={styles.handle} d="M175 42 H166 C166 54 170 60 177 61 M201 42 H210 C210 54 206 60 199 61" />
      <path className={`${styles.sun} ${styles.outline}`} d="M175 34 H201 V46 C201 60 195 68 188 68 C181 68 175 60 175 46 Z" />
      <rect className={styles.lineFill} x="185" y="68" width="6" height="9" />
      <rect className={styles.lineFill} x="177" y="76" width="22" height="7" rx="2" />
      <Sparkle x={150} y={60} />
      <Sparkle x={222} y={50} size={0.6} />
      <path className={styles.trail} d="M52 164 L98 134 L144 104 L172 92" />
    </g>
  )
}

/** A new day: the sun coming up over the hills, and the birds already out. */
function Sunrise() {
  return (
    <>
      <circle className={styles.glow} cx="120" cy="172" r="92" />
      <path
        className={styles.ray}
        d="M120 52 V74 M56 84 L70 100 M184 84 L170 100 M24 150 H44 M196 150 H216"
      />
      <circle className={styles.sun} cx="120" cy="172" r="48" />
      <path className={styles.hillFar} d="M0 172 C40 152 80 160 120 174 C160 186 200 170 240 160 V240 H0 Z" />
      <path className={styles.hill} d="M0 198 C50 182 100 194 140 206 C180 216 210 204 240 198 V240 H0 Z" />
      <path className={styles.bird} d="M58 70 Q66 62 74 70 Q82 62 90 70" />
      <path className={styles.bird} d="M150 48 Q156 42 162 48 Q168 42 174 48" />
      <path className={styles.bird} d="M190 76 Q195 71 200 76 Q205 71 210 76" />
    </>
  )
}

/** Focus: an arrow in the centre of the target, flown in from the top left (the right is the handwriting's). */
function Target() {
  return (
    <>
      <ellipse className={styles.hill} cx="120" cy="226" rx="118" ry="24" />
      <path className={styles.legs} d="M104 212 L120 160 L136 212" />
      <circle className={`${styles.paper} ${styles.outline}`} cx="118" cy="112" r="62" />
      <circle className={styles.coral} cx="118" cy="112" r="48" />
      <circle className={styles.paper} cx="118" cy="112" r="34" />
      <circle className={styles.coral} cx="118" cy="112" r="20" />
      <circle className={styles.sun} cx="118" cy="112" r="8" />
      <path className={styles.shaft} d="M118 112 L40 40" />
      <path className={styles.blue} d="M40 40 L48 26 L32 22 Z M40 40 L26 48 L22 32 Z" />
      <rect className={styles.green} x="186" y="58" width="9" height="9" rx="2" transform="rotate(20 190 62)" />
      <rect className={styles.purple} x="200" y="120" width="9" height="9" rx="2" transform="rotate(-15 204 124)" />
      <rect className={styles.blue} x="36" y="150" width="8" height="8" rx="2" transform="rotate(35 40 154)" />
      <Sparkle x={60} y={98} size={0.7} />
      <Sparkle x={186} y={172} size={0.6} />
    </>
  )
}

/** One drawing per name — the type insists every name in the list has one. */
const DRAWINGS: Record<PictureName, () => ReactElement> = {
  summit: Summit,
  growth: Growth,
  idea: Idea,
  rocket: Rocket,
  stairs: Stairs,
  sunrise: Sunrise,
  target: Target,
}
