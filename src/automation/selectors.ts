// Supported selectors observed in pinned V09 fd2a62a; live SmartEditor validation is separate.
export const NAVER_BLOG_WRITE_URL = 'https://blog.naver.com/GoBlogWrite.naver';
export const NAVER_HOME_URL = 'https://www.naver.com/';
export const selectors = {
  title: [
    "div.se-section-documentTitle [contenteditable='true']",
    "div.se-title-text [contenteditable='true']",
    'div.se-title-text p',
  ],
  body: [
    'div.se-module.se-module-text.__se-unit:not(.se-title-text) p.se-text-paragraph',
    '.se-components-wrap .se-section-text p.se-text-paragraph',
  ],
  bold: ["button[data-name='bold']"],
  alignmentDropdown: [
    "button[data-group='propertyToolbar'][data-type='drop-down'][data-name^='align-drop-down']",
  ],
  alignmentCenterOption: [
    "button[data-name='align-drop-down-with-justify'][data-role='option'][data-value='center']",
  ],
  quoteMenu: [
    "button.se-document-toolbar-select-option-button[data-name='quotation']",
    "button[data-name='quotation']",
  ],
  quoteOption: [
    "button[data-group='documentToolbar'][data-name='quotation'][data-role='option']" +
      "[data-value='default'][data-type='icon-select']",
    "button[data-log='dot.quota0']",
  ],
  quoteBlock: ['.se-quotation'],
  images: '.se-components-wrap .se-module-image',
  imageToolbar: ["button[data-name='image']", "button[data-log='dot.img']"],
  fileInput: ["input[type='file'][accept*='image']", "input[type='file']"],
  draftSave: ["button[data-click-area='tpb.save']"],
  draftCount: "button[class*='save_count_btn']",
  existingDraftDialog: ".se-popup-alert-confirm, .se-popup-alert, [data-group='popupLayer']",
} as const;
