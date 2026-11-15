// Status presentation for JS. Colors and every other visual rule live in
// docs/DESIGN.md (tokens in globals.css, classes in tailwind.config.js).

// One Tag tone per lead status (DESIGN.md section 6). Status is never shown
// by color alone: the label always prints too.
export const STATUS_TAGS = {
  new: 'outline',
  in_queue: 'outline',
  in_progress: 'signal',
  contacted: 'solid',
  voicemail: 'outline',
  no_answer: 'outline',
  callback_scheduled: 'solid',
  no_contact_number: 'dashed',
  no_contact_person: 'dashed',
  dnc: 'solid',
  cold: 'muted',
};

export const STATUS_LABELS = {
  new: 'New',
  in_queue: 'In queue',
  in_progress: 'In progress',
  contacted: 'Contacted',
  voicemail: 'Voicemail',
  no_answer: 'No answer',
  callback_scheduled: 'Callback scheduled',
  no_contact_number: 'Bad number',
  no_contact_person: 'No contact — person',
  dnc: 'DNC',
  cold: 'Cold',
};
