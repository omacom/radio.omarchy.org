/* Vite's ?raw import, for the mirrored feed. The build reads the feed out of
   the repo rather than off disk at render time, so it is a dependency of the
   build and `astro dev` picks up a new episode the moment it is mirrored in. */
declare module '*?raw' {
  const content: string;
  export default content;
}

/* The experimental HTML-in-canvas attribute. A canvas carrying it lays out its
   subtree, which is what lets src/scripts/lcd-vhs.ts host the readout inside
   one and read it back as a texture. Not in Astro's own attribute types
   because it is not in the HTML standard yet. */
declare namespace astroHTML.JSX {
  interface CanvasHTMLAttributes {
    layoutsubtree?: string | boolean;
  }
}
