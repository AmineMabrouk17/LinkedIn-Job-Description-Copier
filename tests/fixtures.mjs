/**
 * A trimmed-down but structurally faithful LinkedIn job page.
 *
 * Two things are deliberate:
 *   - every class name is a hashed build artefact (`_496fcd88`, `eebe61b8`, …)
 *     so the tests fail if the extractor ever reaches for one;
 *   - a decoy `data-testid="expandable-text-box"` (the company blurb) appears
 *     *before* the job description, so "first box on the page" is not enough.
 */
export const jobPage = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta property="og:title" content="Full Stack Developer at Galadrim | LinkedIn" />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    "title": "Full Stack Developer",
    "hiringOrganization": { "@type": "Organization", "name": "Galadrim" },
    "jobLocation": {
      "@type": "Place",
      "address": {
        "addressLocality": "Paris",
        "addressRegion": "Île-de-France",
        "addressCountry": "FR"
      }
    }
  }
  </script>
</head>
<body>
  <header class="_496fcd88 eebe61b8 b59dc2c0">
    <nav class="_9e907aaf">Jobs | Messages | Notifications</nav>
  </header>

  <section class="_34ec36b2 dbc981b1 cdc21505">
    <h2 class="_496fcd88">About the company</h2>
    <span data-testid="expandable-text-box" class="eebe61b8">
      Galadrim is a software company founded in 2015 by Ludovic Hurbez and Anthony
      Lespruch. We love food and we love software, and we think you will love
      working with us too.
    </span>
  </section>

  <main class="eebe61b8 _9e907aaf">
    <section class="_34ec36b2">
      <div class="_496fcd88">
        <h2 class="_34ec36b2">About the job</h2>
        <button class="eebe61b8" aria-label="Show more">…more</button>
      </div>

      <span data-testid="expandable-text-box" class="_496fcd88">

        <p>Notre équipe</p>

        <p>
          Plus de 90 ingénieurs issus des meilleures écoles composent notre équipe technique.
        </p>

        <p>Ton rôle</p>

        <p>Il ne s'agit pas d'une mission unique.</p>

        <ul>
          <li>Développer des fonctionnalités</li>
          <li>Participer aux choix techniques
            <ul>
              <li>Architecture</li>
              <li>Revue de code</li>
            </ul>
          </li>
          <li>Collaborer avec les équipes</li>
        </ul>

        <p><strong>Les conditions</strong></p>
        <p>Salaire&nbsp;: 60k–70k<br>Remote friendly</p>

        <p class="visually-hidden">Cette annonce est reservee aux personnes handicapees.</p>
        <button class="eebe61b8">Postuler</button>
        <script>window.tracker = { track: function () {} };</script>

      </span>
    </section>

    <section class="_34ec36b2">
      <h2>Comments</h2>
      <p>Great company, I applied last week and heard back in two days.</p>
    </section>
  </main>
</body>
</html>
`;

/** Same page, description hidden until the "…more" toggle is clicked. */
export const collapsedJobPage = `
<!DOCTYPE html>
<html lang="en">
<body>
  <section>
    <h2>About the job</h2>
    <span data-testid="expandable-text-box">
      <p style="display: none">Hidden until expanded.</p>
      <p>Visible part of the description that is long enough to be plausible.</p>
      <button id="toggle">Show more</button>
    </span>
  </section>
</body>
</html>
`;

/** French locale: the heading is translated, the classes are hashed. */
export const frenchJobPage = `
<!DOCTYPE html>
<html lang="fr">
<body>
  <section class="_496fcd88">
    <h2 class="eebe61b8">À propos du poste</h2>
    <div data-testid="expandable-text-box">
      <p>Notre équipe</p>
      <p>Plus de 90 ingénieurs composent notre équipe technique à Paris.</p>
      <ul><li>Développer</li><li>Participer</li></ul>
    </div>
  </section>
</body>
</html>
`;


/**
 * A real posting, captured 2026-09-25 from
 * https://www.linkedin.com/jobs/view/4453965703/ (Galadrim, French locale).
 *
 * Two things here are impossible to guess and both used to break extraction:
 *
 *  1. The text box is a <span> *inside* a <p>, so the HTML parser closes that
 *     <p> at the first inner <p> and pops the <span> as well. The box
 *     therefore holds only "Notre équipe"; every following paragraph and list
 *     is its sibling. Selecting the box selects one line.
 *  2. Lists are written <ul><p><li>…</li></p></ul>, which parses into <ul>
 *     with empty <p> elements interleaved between the items.
 */
export const hoistedBoxJobPage = `
<!DOCTYPE html>
<html lang="fr">
<body>
  <div id="JobDetails_AboutTheJob_4453965703">
    <div>
      <div><h2 class="a3b8ceaa">About the job</h2></div>
      <p class="_1f2f8eef"><span data-testid="expandable-text-box">Notre équipe</span></p>
      <p>Plus de 90 ingénieurs.</p>
      <p>Dans un contexte de forte croissance.</p>
      <p>Il ne s'agit pas d'une mission unique : l'objectif est de rejoindre notre <strong>pool de freelances</strong> afin de te proposer régulièrement des missions.</p>
      <p>Concrètement, tu seras amené(e) à :</p>
      <ul class="_79ca1dba _6b73e47f fa3d9e2a"><p><li><strong>Développer des fonctionnalités</strong> en construisant un code de qualité</li></p><p><li><strong>Participer aux choix techniques</strong> pour concevoir des produits évolutifs</li></p><p><li><strong>Collaborer étroitement</strong> avec les PM et designers</li></p></ul>
      <p><strong>Exemples de projets</strong></p>
      <ul class="_79ca1dba fa3d9e2a"><p><li>Nous avons travaillé avec le <strong>CEA</strong>, l'un des principaux organismes de recherche.</li></p><p><li>La <strong>FFTir</strong> a fait appel à nous pour moderniser leur outil interne.</li></p></ul>Nos technos<p>Chez Galadrim, la technologie est un moyen, pas une fin.</p>
      <ul class="_79ca1dba fa3d9e2a"><p><li>Outils d'IA : Claude Code, Codex, Cursor</li></p><p><li>Backend &amp; infra : Node.js (Adonis, Nest.js), PostgreSQL, AWS</li></p><p><li>Frontend : JavaScript / TypeScript, React, React Native<br><br></li></p></ul>Les conditions<p>Les missions proposées sont ouvertes à du full remote, avec des rendez-vous réguliers en présentiel.</p>
      <p>Le recrutement se découpe en 3 phases :</p>
      <ul class="_79ca1dba fa3d9e2a"><p><li>Un quiz technique en ligne de 15 minutes</li></p><p><li>Un entretien technique en visio de 30 minutes</li></p><p><li>Un entretien technique de 45 minutes avec le CTO</li></p></ul>
      <button data-testid="expandable-text-button" aria-hidden="true"><span><span>…</span><span> more</span></span></button>
    </div>
  </div>
  <div id="JobDetails_AboutTheCompany_1">
    <h2>About the company</h2>
    <p><span data-testid="expandable-text-box">Galadrim is the tech and AI partner for ambitious companies.<br><br>Since 2017, we have supported over 800 entrepreneurs.<button data-testid="expandable-text-button" aria-hidden="true">… more</button></span></p>
  </div>
</body>
</html>
`;

/**
 * A job page as LinkedIn serves it before the cookie banner is accepted: no
 * ld+json, no Open Graph, everything only in the top card. Reproduces the
 * report where the header came out as "Job: About the job".
 */
export const guestJobPage = `
<!DOCTYPE html>
<html lang="de">
<head><title>Werkstudent (m/f/d) Softwareentwicklung bei SC Media House | LinkedIn</title></head>
<body>
  <main>
    <section class="top-card-layout">
      <h2 class="top-card-layout__title serif">Werkstudent (m/f/d) Softwareentwicklung</h2>
      <h4 class="top-card-layout__second-subline"><a class="topcard__org-name-link" href="/company/sc-media-house">SC Media House</a></h4>
      <span class="topcard__text topcard__flavor--bullet">Hamburg, Deutschland &middot; Vor Ort &middot; Softwareentwicklung</span>
    </section>
    <section class="description">
      <div>
        <h2>About the job</h2>
        <p><span data-testid="expandable-text-box">Wir sind eine der führenden Influencer-Marketing-Agenturen Deutschlands.</span></p>
        <p>Statt bei null zu starten, arbeitest du an der Weiterentwicklung eines echten Produkts.</p>
        <ul class="_79ca1dba"><p><li>Entwicklung unserer REST-API mit Node.js und Express</li></p><p><li>Anbindung externer APIs wie CRM und Social APIs</li></p></ul>
      </div>
    </section>
  </main>
</body>
</html>
`;

/** No structured data and no top card at all: the description is all there is. */
export const bareDescriptionJobPage = `
<!DOCTYPE html>
<html lang="en">
<body>
  <section>
    <div>
      <h2>About the job</h2>
      <p><span data-testid="expandable-text-box">You will work on the platform that powers our campaigns.</span></p>
      <p>The second paragraph makes the description long enough to be plausible.</p>
    </div>
  </section>
</body>
</html>
`;

/**
 * Heading and description share one parent, and the description is *before* the
 * heading's own block is reached — the layout where cutting the node list at the
 * heading would leave nothing to read.
 */
export const headingSharesParentJobPage = `
<!DOCTYPE html>
<html lang="en">
<body>
  <div class="_496fcd88">
    <div>
      <h2>About the job</h2>
      <p>You will build and ship internal tooling used by every team.</p>
      <ul class="_79ca1dba"><li>Own a project end to end</li><li>Pair with design weekly</li></ul>
    </div>
  </div>
  <div>
    <h2>About the company</h2>
    <p><span data-testid="expandable-text-box">We are a small team with a large backlog, founded in 2019.</span></p>
  </div>
</body>
</html>
`;

/**
 * The heading sits five wrappers deep and the description box is a sibling of
 * the outermost wrapper — too far for a forward-sibling walk, so only the
 * shared-ancestor search can find it.
 */
export const deeplyNestedJobPage = `
<!DOCTYPE html>
<html lang="en">
<body>
  <section class="_496fcd88">
    <div class="eebe61b8">
      <div class="b59dc2c0">
        <div class="_9e907aaf">
          <div class="dbc981b1">
            <div class="cdc21505">
              <h2>About the job</h2>
            </div>
          </div>
        </div>
      </div>
    </div>
    <span data-testid="expandable-text-box">
      <p>The team is looking for a backend engineer to work on distributed systems.</p>
      <p>You will work with a small team and a lot of autonomy.</p>
    </span>
  </section>
</body>
</html>
`;

/**
 * No `data-testid` anywhere: only LinkedIn's BEM class remains as a signal,
 * alongside the section heading.
 */
export const noTestIdJobPage = `
<!DOCTYPE html>
<html lang="en">
<body>
  <section class="_496fcd88">
    <h2 class="eebe61b8">About the job</h2>
    <div class="jobs-description__text" style="white-space: pre-line">
      <p>We are looking for a full stack developer to join our Paris team.</p>
      <p>You will work on TypeScript, React and Node.</p>
    </div>
  </section>
</body>
</html>
`;

/** A LinkedIn page with no job description at all (feed, profile, …). */
export const nonJobPage = `
<!DOCTYPE html>
<html lang="en">
<body>
  <main>
    <h1>Notifications</h1>
    <span data-testid="expandable-text-box">See job description</span>
    <p>Nothing to see here.</p>
  </main>
</body>
</html>
`;
