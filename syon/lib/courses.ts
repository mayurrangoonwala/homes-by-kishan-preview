// Course catalogue — the SEO/GEO content spine.
//
// Every regulatory claim (`regulation`, `validity`, `mandatory`) is a DRAFT
// pending Syon's sign-off. Publishing an incorrect compliance claim on a
// safety-training site is a commercial and legal risk, not a typo. Each is
// listed in CONTENT-REVIEW.md for confirmation before launch.
//
// This file is the single source of truth: pages, sitemap, JSON-LD and the
// internal link graph are all generated from it. Adding a course here creates
// its detail page plus one landing page per city automatically.

export type Faq = {
  question: string;
  answer: string;
};

/**
 * Who actually stands in front of the class.
 *
 * Syon does not hold Chief Prevention Officer approval itself — its delivery
 * partners do. Ontario only accepts a CPO-approved provider for Working at
 * Heights, so claiming or implying that approval for Syon would be a false
 * compliance claim on a page that customers rely on to stay legal. It is
 * modelled as data rather than fixed in copy so no page can drift back to the
 * wrong version.
 */
export type DeliveryModel =
  /** Syon's own trainers deliver it. */
  | 'syon'
  /** Coordinated by Syon, delivered by an approved partner provider. */
  | 'approved-partner';

export type Course = {
  slug: string;
  name: string;
  shortName: string;
  deliveredBy: DeliveryModel;
  /**
   * Query variants real buyers type. Used for internal anchor-text variation
   * and to seed the keyword map — NOT for meta keywords (dead since 2009) and
   * never rendered as hidden text.
   */
  aliases: string[];
  /** One-sentence extractable definition. This is the GEO answer target. */
  summary: string;
  /** Longer positioning paragraph for the page body. */
  description: string;
  duration: string;
  format: string;
  /** DRAFT — verify with Syon. */
  validity: string;
  /** DRAFT — verify with Syon. Ontario regulation the training maps to. */
  regulation: string;
  /** Whether Ontario law requires this training for the stated audience. */
  mandatory: boolean;
  audience: string;
  outcomes: string[];
  faqs: Faq[];
};

export const courses: Course[] = [
  {
    slug: 'working-at-heights',
    name: 'Working at Heights Training',
    shortName: 'Working at Heights',
    // Syon is not CPO-approved; its delivery partners are. Ontario accepts
    // only a CPO-approved provider for this program, so the distinction is
    // legally material and stated openly on every page.
    deliveredBy: 'approved-partner',
    aliases: [
      'working at heights training',
      'WAH training',
      'fall protection certification',
      'CPO approved working at heights',
      'heights training certificate',
    ],
    summary:
      'Working at Heights is a Chief Prevention Officer (CPO) approved program required for construction workers who use fall protection equipment in Ontario.',
    description:
      'Our Working at Heights program covers hazard recognition, fall protection hierarchy, harness inspection and fitting, anchor points, ladders and travel restraint. Delivered on your site or at a scheduled session, with practical equipment handling included.',
    duration: '6.5 hours',
    format: 'In-person, on-site or at a scheduled venue',
    validity: '3 years from date of completion',
    regulation: "O. Reg. 213/91 (Construction Projects) and O. Reg. 297/13",
    mandatory: true,
    audience:
      'Construction workers who use a travel restraint system, fall restricting system, fall arrest system, safety net, work belt or safety belt',
    outcomes: [
      'Identify fall hazards before work begins',
      'Apply the hierarchy of fall protection controls',
      'Inspect, fit and maintain a full-body harness',
      'Select and assess anchor points correctly',
      'Understand rescue planning obligations',
    ],
    faqs: [
      {
        question: 'How long is Working at Heights training valid in Ontario?',
        answer:
          'A Working at Heights certificate is valid for three years from the date of completion. A refresher program is required to maintain validity beyond that period.',
      },
      {
        question: 'Who is required to take Working at Heights training?',
        answer:
          'Any worker on a construction project in Ontario who uses fall protection equipment must complete a CPO-approved Working at Heights program before working at height.',
      },
      {
        question: 'Can Working at Heights training be delivered on our site?',
        answer:
          'Yes. Syon Safety arranges Working at Heights training at your workplace across Ontario, which avoids travel time and lost productivity for your crew.',
      },
      {
        question: 'Is Syon Safety a CPO-approved training provider?',
        answer:
          'Working at Heights must be delivered by a training provider approved by Ontario\'s Chief Prevention Officer. Syon Safety coordinates this program and it is delivered by an approved provider, so the certificate your workers receive is issued by that approved provider and is fully valid across Ontario.',
      },
    ],
  },
  {
    slug: 'whmis',
    name: 'WHMIS 2015 (GHS) Training',
    shortName: 'WHMIS',
    deliveredBy: 'syon',
    aliases: [
      'WHMIS training',
      'WHMIS 2015 certification',
      'GHS training',
      'hazardous materials training',
      'WHMIS online course Ontario',
    ],
    summary:
      'WHMIS 2015 training teaches workers to identify hazardous products, read supplier labels and safety data sheets, and follow safe handling procedures.',
    description:
      'WHMIS 2015 aligns Canada with the Globally Harmonized System. This program covers the hazard classes, pictograms, supplier and workplace labels, and the sixteen-section safety data sheet, with worked examples from your own inventory where you supply them.',
    duration: '2 to 3 hours',
    format: 'In-person or blended',
    validity: 'Annual review recommended; no fixed statutory expiry',
    regulation: 'Ontario Regulation 860 (WHMIS) under the OHSA',
    mandatory: true,
    audience:
      'Any worker who works with or near a hazardous product, and their supervisors',
    outcomes: [
      'Recognise all WHMIS 2015 hazard pictograms',
      'Read and act on a supplier label and workplace label',
      'Navigate a 16-section safety data sheet',
      'Apply correct storage, handling and disposal practice',
      'Respond appropriately to a spill or exposure',
    ],
    faqs: [
      {
        question: 'Does WHMIS training expire?',
        answer:
          'WHMIS has no fixed statutory expiry date in Ontario. Employers are required to ensure worker knowledge remains current, and an annual review is the common industry practice.',
      },
      {
        question: 'What is the difference between WHMIS 1988 and WHMIS 2015?',
        answer:
          'WHMIS 2015 adopts the Globally Harmonized System, replacing the older hazard symbols with GHS pictograms and replacing material safety data sheets with standardised 16-section safety data sheets.',
      },
      {
        question: 'Do supervisors need WHMIS training as well as workers?',
        answer:
          'Yes. Supervisors need WHMIS competency to direct work safely and to meet their due-diligence obligations under the Occupational Health and Safety Act.',
      },
    ],
  },
  {
    slug: 'forklift-operator',
    name: 'Forklift and Lift Truck Operator Training',
    shortName: 'Forklift Operator',
    deliveredBy: 'syon',
    aliases: [
      'forklift training',
      'forklift certification',
      'lift truck operator training',
      'forklift licence Ontario',
      'counterbalance forklift course',
    ],
    summary:
      'Forklift operator training combines classroom theory with a hands-on practical evaluation, certifying operators as competent under CSA B335 and the OHSA.',
    description:
      'Training covers stability and the load centre, pre-use inspection, pedestrian safety, load handling, and refuelling or battery changing. The practical evaluation is conducted on your own equipment in your own facility, so operators are assessed in the environment they actually work in.',
    duration: '4 to 8 hours depending on class and prior experience',
    format: 'On-site, theory plus practical evaluation',
    validity: '3 years is standard industry practice',
    regulation: 'CSA B335 series and the OHSA duty to ensure competency',
    mandatory: true,
    audience:
      'Anyone who operates a powered lift truck, and the supervisors responsible for them',
    outcomes: [
      'Complete a documented pre-use inspection',
      'Apply the stability triangle and load centre principles',
      'Operate safely around pedestrians and in confined aisles',
      'Handle, stack and de-stack loads correctly',
      'Follow safe refuelling and battery-charging procedure',
    ],
    faqs: [
      {
        question: 'Is a forklift licence required in Ontario?',
        answer:
          'Ontario does not issue a government forklift licence. The Occupational Health and Safety Act requires employers to ensure operators are competent, which is demonstrated through training and a documented practical evaluation.',
      },
      {
        question: 'How often does forklift certification need renewing?',
        answer:
          'Three years is the widely accepted industry standard for refresher training. Re-evaluation is also expected after an incident, a near miss, or a change of equipment class.',
      },
      {
        question: 'Can you train operators on our own forklifts?',
        answer:
          'Yes, and it is the preferred approach. Practical evaluation on your own equipment and in your own aisles produces a more meaningful competency assessment.',
      },
    ],
  },
  {
    slug: 'jhsc-certification',
    name: 'JHSC Certification Training (Part 1 and Part 2)',
    shortName: 'JHSC Certification',
    deliveredBy: 'syon',
    aliases: [
      'JHSC certification training',
      'joint health and safety committee training',
      'JHSC part 1',
      'JHSC part 2',
      'health and safety committee certification Ontario',
    ],
    summary:
      'JHSC certification training qualifies committee members to act as certified members on a Joint Health and Safety Committee under the Occupational Health and Safety Act.',
    description:
      'Part 1 covers the legislative framework, rights and duties, and the role of the committee. Part 2 applies that framework to the specific hazards of your workplace. Both parts are required for a member to be certified.',
    duration: 'Part 1: 3 days. Part 2: 2 days.',
    format: 'In-person, on-site or scheduled',
    validity:
      'Certification does not expire, but a refresher is required every 3 years to remain current',
    regulation: 'Occupational Health and Safety Act, section 9',
    mandatory: true,
    audience:
      'Worker and management members of a Joint Health and Safety Committee at workplaces with 20 or more workers',
    outcomes: [
      'Understand the OHSA framework and the internal responsibility system',
      'Carry out effective workplace inspections',
      'Investigate incidents and identify root causes',
      'Recognise and assess workplace-specific hazards',
      'Make and track effective committee recommendations',
    ],
    faqs: [
      {
        question: 'Which workplaces need a certified JHSC member?',
        answer:
          'Ontario workplaces that regularly employ 20 or more workers generally require a Joint Health and Safety Committee with at least one certified worker member and one certified management member.',
      },
      {
        question: 'Do I need both Part 1 and Part 2 to be certified?',
        answer:
          'Yes. Part 1 covers the general legislative and committee framework, and Part 2 applies it to your specific workplace hazards. A member is certified only after completing both.',
      },
      {
        question: 'Does JHSC certification expire?',
        answer:
          'Certification itself does not expire, but certified members are expected to complete a refresher within three years to keep their certification current.',
      },
    ],
  },
  {
    slug: 'first-aid-cpr',
    name: 'Standard First Aid and CPR/AED Training',
    shortName: 'First Aid and CPR',
    deliveredBy: 'syon',
    aliases: [
      'first aid training',
      'CPR certification',
      'standard first aid course',
      'AED training',
      'workplace first aid Ontario',
    ],
    summary:
      'Standard First Aid with CPR/AED is a two-day program that meets WSIB first aid requirements for designated workplace first aid attendants.',
    description:
      'The program covers primary and secondary assessment, CPR at the chosen level, AED operation, choking, wound and bleeding control, fractures, and medical emergencies including anaphylaxis. Certification is issued on successful completion.',
    duration: '2 days (approximately 14 hours)',
    format: 'In-person, on-site or scheduled',
    validity: '3 years',
    regulation: 'WSIB Regulation 1101 (First Aid Requirements)',
    mandatory: true,
    audience:
      'Designated workplace first aid attendants and any worker required to respond to a medical emergency',
    outcomes: [
      'Perform a primary and secondary casualty assessment',
      'Deliver CPR and operate an AED',
      'Manage choking in adults, children and infants',
      'Control severe bleeding and treat wounds',
      'Recognise and respond to medical emergencies',
    ],
    faqs: [
      {
        question: 'How many first aid trained staff does a workplace need?',
        answer:
          'WSIB Regulation 1101 sets the requirement by shift size. Smaller workplaces generally need at least one qualified first aider on every shift, with the requirement scaling up as the number of workers per shift increases.',
      },
      {
        question: 'How long is a Standard First Aid certificate valid?',
        answer:
          'Standard First Aid with CPR certification is valid for three years from the date of issue.',
      },
      {
        question: 'What is the difference between Emergency and Standard First Aid?',
        answer:
          'Emergency First Aid is a one-day program covering life-threatening emergencies. Standard First Aid is two days and adds a broader range of injuries and medical conditions, and is what WSIB Regulation 1101 requires for most designated attendants.',
      },
    ],
  },
  {
    slug: 'confined-space',
    name: 'Confined Space Entry Training',
    shortName: 'Confined Space',
    deliveredBy: 'syon',
    aliases: [
      'confined space training',
      'confined space entry course',
      'confined space awareness',
      'confined space rescue training',
      'tank entry training Ontario',
    ],
    summary:
      'Confined space entry training prepares entrants, attendants and supervisors to work safely in confined spaces under a written entry plan and permit system.',
    description:
      'Covers confined space identification, atmospheric hazards and gas detection, ventilation, the entry permit system, roles and responsibilities, and rescue planning. Delivered against your own written confined space program where you have one.',
    duration: '8 hours',
    format: 'In-person, on-site preferred',
    validity: '3 years is standard industry practice',
    regulation: 'O. Reg. 632/05 (Confined Spaces)',
    mandatory: true,
    audience:
      'Entrants, attendants, entry supervisors and anyone who plans confined space work',
    outcomes: [
      'Identify a confined space and its hazards',
      'Interpret atmospheric testing results',
      'Apply the entry permit and written plan requirements',
      'Understand attendant and entrant responsibilities',
      'Recognise why rescue planning must precede entry',
    ],
    faqs: [
      {
        question: 'What counts as a confined space in Ontario?',
        answer:
          'Under O. Reg. 632/05 a confined space is a fully or partially enclosed space that is not designed and constructed for continuous human occupancy, and in which atmospheric hazards may occur because of its construction, location, contents or the work carried out in it.',
      },
      {
        question: 'Is a rescue plan required before entering a confined space?',
        answer:
          'Yes. Ontario requires an adequate written rescue procedure to be in place, with rescue workers and equipment available, before any worker enters a confined space.',
      },
      {
        question: 'Who needs confined space training?',
        answer:
          'Everyone involved in the entry, including entrants, attendants stationed outside the space, entry supervisors, and those who prepare the written entry plan.',
      },
    ],
  },
  {
    slug: 'health-and-safety-awareness',
    name: 'Worker and Supervisor Health and Safety Awareness',
    shortName: 'Health and Safety Awareness',
    deliveredBy: 'syon',
    aliases: [
      'worker health and safety awareness training',
      'supervisor health and safety awareness',
      'mandatory awareness training Ontario',
      'OHSA awareness training',
    ],
    summary:
      'Health and safety awareness training is mandatory for every worker and every supervisor in Ontario under O. Reg. 297/13.',
    description:
      'The worker program covers OHSA rights and duties, the role of the JHSC, common hazards and reporting. The supervisor program adds the duties of a supervisor, hazard control and the internal responsibility system. Both are required by regulation and are frequently the first item a Ministry inspector asks to see.',
    duration: 'Worker: 1 hour. Supervisor: 2 hours.',
    format: 'In-person or blended',
    validity: 'No expiry, but records must be kept',
    regulation: 'O. Reg. 297/13 (Occupational Health and Safety Awareness and Training)',
    mandatory: true,
    audience: 'Every worker and every supervisor in an Ontario workplace',
    outcomes: [
      'Know the three worker rights under the OHSA',
      'Understand employer, supervisor and worker duties',
      'Recognise common workplace hazards',
      'Know how to report hazards and refuse unsafe work',
      'Maintain the training records an inspector will request',
    ],
    faqs: [
      {
        question: 'Is health and safety awareness training mandatory in Ontario?',
        answer:
          'Yes. Under O. Reg. 297/13 every employer must ensure that workers complete a basic occupational health and safety awareness program, and that supervisors complete the supervisor program, as soon as reasonably possible after being hired.',
      },
      {
        question: 'How long does awareness training take?',
        answer:
          'The worker program takes about one hour and the supervisor program about two hours, which makes it practical to deliver to a full team in a single visit.',
      },
      {
        question: 'Do we need to keep records of awareness training?',
        answer:
          'Yes. Employers must maintain a record of the training completed by each worker and supervisor, and must provide written proof on request.',
      },
    ],
  },
  {
    slug: 'fall-protection',
    name: 'Fall Protection and Elevated Work Platform Training',
    shortName: 'Fall Protection',
    deliveredBy: 'syon',
    aliases: [
      'fall protection training',
      'elevated work platform training',
      'EWP training',
      'scissor lift training',
      'aerial lift certification Ontario',
    ],
    summary:
      'Fall protection and elevated work platform training certifies workers to select, inspect and use fall protection systems and to operate scissor and boom lifts safely.',
    description:
      'For workplaces outside the construction sector, or alongside Working at Heights for construction crews. Covers system selection, harness inspection and donning, anchorage, and the safe operation and pre-use inspection of elevated work platforms.',
    duration: '4 to 8 hours depending on scope',
    format: 'On-site, theory plus practical',
    validity: '3 years is standard industry practice',
    regulation: 'O. Reg. 851 (Industrial Establishments) and the CSA B354 series',
    mandatory: true,
    audience:
      'Industrial and maintenance workers exposed to fall hazards, and elevated work platform operators',
    outcomes: [
      'Select the appropriate fall protection system for the task',
      'Inspect and correctly don a full-body harness',
      'Calculate fall clearance and identify suitable anchorage',
      'Complete an elevated work platform pre-use inspection',
      'Operate a scissor or boom lift within its safe working envelope',
    ],
    faqs: [
      {
        question:
          'What is the difference between Fall Protection and Working at Heights?',
        answer:
          'Working at Heights is the CPO-approved program required specifically for construction projects. Fall protection training covers the same hazards for industrial and other non-construction workplaces, where the CPO-approved program is not the governing requirement.',
      },
      {
        question: 'At what height is fall protection required in Ontario?',
        answer:
          'The trigger height depends on the sector and the regulation that applies. In industrial establishments the general threshold is three metres, while construction projects have their own requirements under O. Reg. 213/91.',
      },
      {
        question: 'Do scissor lift operators need separate training?',
        answer:
          'Yes. Elevated work platform operation requires its own training and a documented practical evaluation, which can be combined with fall protection training in a single session.',
      },
    ],
  },
];

export const courseSlugs = courses.map((c) => c.slug);

export function getCourse(slug: string): Course | undefined {
  return courses.find((c) => c.slug === slug);
}

/**
 * How the delivery model is described on the page.
 *
 * Kept next to the data so copy cannot drift away from the fact. Wording is
 * deliberately plain: a customer needs to understand that the certificate is
 * valid, and that the approval sits with the provider who issues it.
 */
export function deliveryLabel(course: Course): string {
  return course.deliveredBy === 'approved-partner'
    ? 'Coordinated by Syon Safety, delivered by an approved training provider'
    : 'Delivered by Syon Safety';
}

/** Verb for sentences of the form "Syon Safety ___ this course in Toronto." */
export function deliveryVerb(course: Course): string {
  return course.deliveredBy === 'approved-partner' ? 'arranges' : 'delivers';
}
