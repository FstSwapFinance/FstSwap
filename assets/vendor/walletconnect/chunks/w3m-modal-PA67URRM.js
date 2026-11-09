import{a as u,b as p,c as b,g as $e,h as Pt}from"./chunk-BBFIABG7.js";import{A as I,B as oe,C as re,D as m,F as R,e as At,g as he,h as It,i as W,j as Pe,k as He,l as ee,o as a,p as Te,u as h,v as te,w as f,x as Nt}from"./chunk-QS6ARBZX.js";import"./chunk-UKF5JCPZ.js";import{A,C as D,D as be,G as w,H as Et,I as P,K as qe,L as Ct,P as B,Q as Me,R as St,S as kt,V as g,W as $,a as U,c as S,d as ft,e as C,k as wt,l as gt,m as yt,r as L,s as bt,t as xt,u as v,v as k,z as vt}from"./chunk-AFJJR67J.js";import"./chunk-Z6JUVL6K.js";import"./chunk-7OPW7N7W.js";import"./chunk-LVBHHSEJ.js";import"./chunk-YIF3A6DG.js";import"./chunk-IM3BSWBF.js";var Tt=f`
  :host {
    display: block;
    border-radius: clamp(0px, ${({borderRadius:e})=>e[8]}, 44px);
    box-shadow: 0 0 0 1px ${({tokens:e})=>e.theme.foregroundPrimary};
    overflow: hidden;
  }
`;var zo=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},Ve=class extends h{render(){return a`<slot></slot>`}};Ve.styles=[I,Tt];Ve=zo([m("wui-card")],Ve);var $t=f`
  :host {
    width: 100%;
  }

  :host > wui-flex {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: ${({spacing:e})=>e[2]};
    padding: ${({spacing:e})=>e[3]};
    border-radius: ${({borderRadius:e})=>e[6]};
    border: 1px solid ${({tokens:e})=>e.theme.borderPrimary};
    box-sizing: border-box;
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    box-shadow: 0px 0px 16px 0px rgba(0, 0, 0, 0.25);
    color: ${({tokens:e})=>e.theme.textPrimary};
  }

  :host > wui-flex[data-type='info'] {
    .icon-box {
      background-color: ${({tokens:e})=>e.theme.foregroundSecondary};

      wui-icon {
        color: ${({tokens:e})=>e.theme.iconDefault};
      }
    }
  }
  :host > wui-flex[data-type='success'] {
    .icon-box {
      background-color: ${({tokens:e})=>e.core.backgroundSuccess};

      wui-icon {
        color: ${({tokens:e})=>e.core.borderSuccess};
      }
    }
  }
  :host > wui-flex[data-type='warning'] {
    .icon-box {
      background-color: ${({tokens:e})=>e.core.backgroundWarning};

      wui-icon {
        color: ${({tokens:e})=>e.core.borderWarning};
      }
    }
  }
  :host > wui-flex[data-type='error'] {
    .icon-box {
      background-color: ${({tokens:e})=>e.core.backgroundError};

      wui-icon {
        color: ${({tokens:e})=>e.core.borderError};
      }
    }
  }

  wui-flex {
    width: 100%;
  }

  wui-text {
    word-break: break-word;
    flex: 1;
  }

  .close {
    cursor: pointer;
    color: ${({tokens:e})=>e.theme.iconDefault};
  }

  .icon-box {
    height: 40px;
    width: 40px;
    border-radius: ${({borderRadius:e})=>e[2]};
    background-color: var(--local-icon-bg-value);
  }
`;var Ge=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},jo={info:"info",success:"checkmark",warning:"warningCircle",error:"warning"},xe=class extends h{constructor(){super(...arguments),this.message="",this.type="info"}render(){return a`
      <wui-flex
        data-type=${b(this.type)}
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        gap="2"
      >
        <wui-flex columnGap="2" flexDirection="row" alignItems="center">
          <wui-flex
            flexDirection="row"
            alignItems="center"
            justifyContent="center"
            class="icon-box"
          >
            <wui-icon color="inherit" size="md" name=${jo[this.type]}></wui-icon>
          </wui-flex>
          <wui-text variant="md-medium" color="inherit" data-testid="wui-alertbar-text"
            >${this.message}</wui-text
          >
        </wui-flex>
        <wui-icon
          class="close"
          color="inherit"
          size="sm"
          name="close"
          @click=${this.onClose}
        ></wui-icon>
      </wui-flex>
    `}onClose(){he.close()}};xe.styles=[I,$t];Ge([u()],xe.prototype,"message",void 0);Ge([u()],xe.prototype,"type",void 0);xe=Ge([m("wui-alertbar")],xe);var _t=f`
  :host {
    display: block;
    position: absolute;
    top: ${({spacing:e})=>e[3]};
    left: ${({spacing:e})=>e[4]};
    right: ${({spacing:e})=>e[4]};
    opacity: 0;
    pointer-events: none;
  }
`;var Rt=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},qo={info:{backgroundColor:"fg-350",iconColor:"fg-325",icon:"info"},success:{backgroundColor:"success-glass-reown-020",iconColor:"success-125",icon:"checkmark"},warning:{backgroundColor:"warning-glass-reown-020",iconColor:"warning-100",icon:"warningCircle"},error:{backgroundColor:"error-glass-reown-020",iconColor:"error-125",icon:"warning"}},_e=class extends h{constructor(){super(),this.unsubscribe=[],this.open=he.state.open,this.onOpen(!0),this.unsubscribe.push(he.subscribeKey("open",t=>{this.open=t,this.onOpen(!1)}))}disconnectedCallback(){this.unsubscribe.forEach(t=>t())}render(){let{message:t,variant:o}=he.state,i=qo[o];return a`
      <wui-alertbar
        message=${t}
        backgroundColor=${i?.backgroundColor}
        iconColor=${i?.iconColor}
        icon=${i?.icon}
        type=${o}
      ></wui-alertbar>
    `}onOpen(t){this.open?(this.animate([{opacity:0,transform:"scale(0.85)"},{opacity:1,transform:"scale(1)"}],{duration:150,fill:"forwards",easing:"ease"}),this.style.cssText="pointer-events: auto"):t||(this.animate([{opacity:1,transform:"scale(1)"},{opacity:0,transform:"scale(0.85)"}],{duration:150,fill:"forwards",easing:"ease"}),this.style.cssText="pointer-events: none")}};_e.styles=_t;Rt([p()],_e.prototype,"open",void 0);_e=Rt([m("w3m-alertbar")],_e);var Ot=f`
  :host {
    position: relative;
  }

  button {
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: transparent;
    padding: ${({spacing:e})=>e[1]};
  }

  /* -- Colors --------------------------------------------------- */
  button[data-type='accent'] wui-icon {
    color: ${({tokens:e})=>e.core.iconAccentPrimary};
  }

  button[data-type='neutral'][data-variant='primary'] wui-icon {
    color: ${({tokens:e})=>e.theme.iconInverse};
  }

  button[data-type='neutral'][data-variant='secondary'] wui-icon {
    color: ${({tokens:e})=>e.theme.iconDefault};
  }

  button[data-type='success'] wui-icon {
    color: ${({tokens:e})=>e.core.iconSuccess};
  }

  button[data-type='error'] wui-icon {
    color: ${({tokens:e})=>e.core.iconError};
  }

  /* -- Sizes --------------------------------------------------- */
  button[data-size='xs'] {
    width: 16px;
    height: 16px;

    border-radius: ${({borderRadius:e})=>e[1]};
  }

  button[data-size='sm'] {
    width: 20px;
    height: 20px;
    border-radius: ${({borderRadius:e})=>e[1]};
  }

  button[data-size='md'] {
    width: 24px;
    height: 24px;
    border-radius: ${({borderRadius:e})=>e[2]};
  }

  button[data-size='lg'] {
    width: 28px;
    height: 28px;
    border-radius: ${({borderRadius:e})=>e[2]};
  }

  button[data-size='xs'] wui-icon {
    width: 8px;
    height: 8px;
  }

  button[data-size='sm'] wui-icon {
    width: 12px;
    height: 12px;
  }

  button[data-size='md'] wui-icon {
    width: 16px;
    height: 16px;
  }

  button[data-size='lg'] wui-icon {
    width: 20px;
    height: 20px;
  }

  /* -- Hover --------------------------------------------------- */
  @media (hover: hover) {
    button[data-type='accent']:hover:enabled {
      background-color: ${({tokens:e})=>e.core.foregroundAccent010};
    }

    button[data-variant='primary'][data-type='neutral']:hover:enabled {
      background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    }

    button[data-variant='secondary'][data-type='neutral']:hover:enabled {
      background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    }

    button[data-type='success']:hover:enabled {
      background-color: ${({tokens:e})=>e.core.backgroundSuccess};
    }

    button[data-type='error']:hover:enabled {
      background-color: ${({tokens:e})=>e.core.backgroundError};
    }
  }

  /* -- Focus --------------------------------------------------- */
  button:focus-visible {
    box-shadow: 0 0 0 4px ${({tokens:e})=>e.core.foregroundAccent020};
  }

  /* -- Properties --------------------------------------------------- */
  button[data-full-width='true'] {
    width: 100%;
  }

  :host([fullWidth]) {
    width: 100%;
  }

  button[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;var ie=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},H=class extends h{constructor(){super(...arguments),this.icon="card",this.variant="primary",this.type="accent",this.size="md",this.iconSize=void 0,this.fullWidth=!1,this.disabled=!1}render(){return a`<button
      data-variant=${this.variant}
      data-type=${this.type}
      data-size=${this.size}
      data-full-width=${this.fullWidth}
      ?disabled=${this.disabled}
    >
      <wui-icon color="inherit" name=${this.icon} size=${b(this.iconSize)}></wui-icon>
    </button>`}};H.styles=[I,oe,Ot];ie([u()],H.prototype,"icon",void 0);ie([u()],H.prototype,"variant",void 0);ie([u()],H.prototype,"type",void 0);ie([u()],H.prototype,"size",void 0);ie([u()],H.prototype,"iconSize",void 0);ie([u({type:Boolean})],H.prototype,"fullWidth",void 0);ie([u({type:Boolean})],H.prototype,"disabled",void 0);H=ie([m("wui-icon-button")],H);var Ut=f`
  button {
    display: block;
    display: flex;
    align-items: center;
    padding: ${({spacing:e})=>e[1]};
    transition: background-color ${({durations:e})=>e.lg}
      ${({easings:e})=>e["ease-out-power-2"]};
    will-change: background-color;
    border-radius: ${({borderRadius:e})=>e[32]};
  }

  wui-image {
    border-radius: 100%;
  }

  wui-text {
    padding-left: ${({spacing:e})=>e[1]};
  }

  .left-icon-container,
  .right-icon-container {
    width: 24px;
    height: 24px;
    justify-content: center;
    align-items: center;
  }

  wui-icon {
    color: ${({tokens:e})=>e.theme.iconDefault};
  }

  /* -- Sizes --------------------------------------------------- */
  button[data-size='lg'] {
    height: 32px;
  }

  button[data-size='md'] {
    height: 28px;
  }

  button[data-size='sm'] {
    height: 24px;
  }

  button[data-size='lg'] wui-image {
    width: 24px;
    height: 24px;
  }

  button[data-size='md'] wui-image {
    width: 20px;
    height: 20px;
  }

  button[data-size='sm'] wui-image {
    width: 16px;
    height: 16px;
  }

  button[data-size='lg'] .left-icon-container {
    width: 24px;
    height: 24px;
  }

  button[data-size='md'] .left-icon-container {
    width: 20px;
    height: 20px;
  }

  button[data-size='sm'] .left-icon-container {
    width: 16px;
    height: 16px;
  }

  /* -- Variants --------------------------------------------------------- */
  button[data-type='filled-dropdown'] {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
  }

  button[data-type='text-dropdown'] {
    background-color: transparent;
  }

  /* -- Focus states --------------------------------------------------- */
  button:focus-visible:enabled {
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    box-shadow: 0 0 0 4px ${({tokens:e})=>e.core.foregroundAccent040};
  }

  /* -- Hover & Active states ----------------------------------------------------------- */
  @media (hover: hover) and (pointer: fine) {
    button:hover:enabled,
    button:active:enabled {
      background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    }
  }

  /* -- Disabled states --------------------------------------------------- */
  button:disabled {
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    opacity: 0.5;
  }
`;var fe=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},Mo={lg:"lg-regular",md:"md-regular",sm:"sm-regular"},Ho={lg:"lg",md:"md",sm:"sm"},ne=class extends h{constructor(){super(...arguments),this.imageSrc="",this.text="",this.size="lg",this.type="text-dropdown",this.disabled=!1}render(){return a`<button ?disabled=${this.disabled} data-size=${this.size} data-type=${this.type}>
      ${this.imageTemplate()} ${this.textTemplate()}
      <wui-flex class="right-icon-container">
        <wui-icon name="chevronBottom"></wui-icon>
      </wui-flex>
    </button>`}textTemplate(){let t=Mo[this.size];return this.text?a`<wui-text color="primary" variant=${t}>${this.text}</wui-text>`:null}imageTemplate(){if(this.imageSrc)return a`<wui-image src=${this.imageSrc} alt="select visual"></wui-image>`;let t=Ho[this.size];return a` <wui-flex class="left-icon-container">
      <wui-icon size=${t} name="networkPlaceholder"></wui-icon>
    </wui-flex>`}};ne.styles=[I,oe,Ut];fe([u()],ne.prototype,"imageSrc",void 0);fe([u()],ne.prototype,"text",void 0);fe([u()],ne.prototype,"size",void 0);fe([u()],ne.prototype,"type",void 0);fe([u({type:Boolean})],ne.prototype,"disabled",void 0);ne=fe([m("wui-select")],ne);var X={ACCOUNT_TABS:[{label:"Tokens"},{label:"Activity"}],SECURE_SITE_ORIGIN:(typeof process<"u"&&typeof process.env<"u"?process.env.NEXT_PUBLIC_SECURE_SITE_ORIGIN:void 0)||"https://secure.walletconnect.org",VIEW_DIRECTION:{Next:"next",Prev:"prev"},ANIMATION_DURATIONS:{HeaderText:120,ModalHeight:150,ViewTransition:150},VIEWS_WITH_LEGAL_FOOTER:["Connect","ConnectWallets","OnRampTokenSelect","OnRampFiatSelect","OnRampProviders"],VIEWS_WITH_DEFAULT_FOOTER:["Networks"]};var Dt=f`
  button {
    background-color: transparent;
    padding: ${({spacing:e})=>e[1]};
  }

  button:focus-visible {
    box-shadow: 0 0 0 4px ${({tokens:e})=>e.core.foregroundAccent020};
  }

  button[data-variant='accent']:hover:enabled,
  button[data-variant='accent']:focus-visible {
    background-color: ${({tokens:e})=>e.core.foregroundAccent010};
  }

  button[data-variant='primary']:hover:enabled,
  button[data-variant='primary']:focus-visible,
  button[data-variant='secondary']:hover:enabled,
  button[data-variant='secondary']:focus-visible {
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
  }

  button[data-size='xs'] > wui-icon {
    width: 8px;
    height: 8px;
  }

  button[data-size='sm'] > wui-icon {
    width: 12px;
    height: 12px;
  }

  button[data-size='xs'],
  button[data-size='sm'] {
    border-radius: ${({borderRadius:e})=>e[1]};
  }

  button[data-size='md'],
  button[data-size='lg'] {
    border-radius: ${({borderRadius:e})=>e[2]};
  }

  button[data-size='md'] > wui-icon {
    width: 16px;
    height: 16px;
  }

  button[data-size='lg'] > wui-icon {
    width: 20px;
    height: 20px;
  }

  button:disabled {
    background-color: transparent;
    cursor: not-allowed;
    opacity: 0.5;
  }

  button:hover:not(:disabled) {
    background-color: var(--wui-color-accent-glass-015);
  }

  button:focus-visible:not(:disabled) {
    background-color: var(--wui-color-accent-glass-015);
    box-shadow:
      inset 0 0 0 1px var(--wui-color-accent-100),
      0 0 0 4px var(--wui-color-accent-glass-020);
  }
`;var we=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},se=class extends h{constructor(){super(...arguments),this.size="md",this.disabled=!1,this.icon="copy",this.iconColor="default",this.variant="accent"}render(){let t={accent:"accent-primary",primary:"inverse",secondary:"default"};return a`
      <button data-variant=${this.variant} ?disabled=${this.disabled} data-size=${this.size}>
        <wui-icon
          color=${t[this.variant]||this.iconColor}
          size=${this.size}
          name=${this.icon}
        ></wui-icon>
      </button>
    `}};se.styles=[I,oe,Dt];we([u()],se.prototype,"size",void 0);we([u({type:Boolean})],se.prototype,"disabled",void 0);we([u()],se.prototype,"icon",void 0);we([u()],se.prototype,"iconColor",void 0);we([u()],se.prototype,"variant",void 0);se=we([m("wui-icon-link")],se);var Lt=Te`<svg width="86" height="96" fill="none">
  <path
    d="M78.3244 18.926L50.1808 2.45078C45.7376 -0.150261 40.2624 -0.150262 35.8192 2.45078L7.6756 18.926C3.23322 21.5266 0.5 26.3301 0.5 31.5248V64.4752C0.5 69.6699 3.23322 74.4734 7.6756 77.074L35.8192 93.5492C40.2624 96.1503 45.7376 96.1503 50.1808 93.5492L78.3244 77.074C82.7668 74.4734 85.5 69.6699 85.5 64.4752V31.5248C85.5 26.3301 82.7668 21.5266 78.3244 18.926Z"
  />
</svg>`;var Wt=Te`
  <svg fill="none" viewBox="0 0 36 40">
    <path
      d="M15.4 2.1a5.21 5.21 0 0 1 5.2 0l11.61 6.7a5.21 5.21 0 0 1 2.61 4.52v13.4c0 1.87-1 3.59-2.6 4.52l-11.61 6.7c-1.62.93-3.6.93-5.22 0l-11.6-6.7a5.21 5.21 0 0 1-2.61-4.51v-13.4c0-1.87 1-3.6 2.6-4.52L15.4 2.1Z"
    />
  </svg>
`;var Bt=f`
  :host {
    position: relative;
    border-radius: inherit;
    display: flex;
    justify-content: center;
    align-items: center;
    width: var(--local-width);
    height: var(--local-height);
  }

  :host([data-round='true']) {
    background: ${({tokens:e})=>e.theme.foregroundPrimary};
    border-radius: 100%;
    outline: 1px solid ${({tokens:e})=>e.core.glass010};
  }

  svg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
  }

  svg > path {
    stroke: var(--local-stroke);
  }

  wui-image {
    width: 100%;
    height: 100%;
    -webkit-clip-path: var(--local-path);
    clip-path: var(--local-path);
    background: ${({tokens:e})=>e.theme.foregroundPrimary};
  }

  wui-icon {
    transform: translateY(-5%);
    width: var(--local-icon-size);
    height: var(--local-icon-size);
  }
`;var ue=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},Z=class extends h{constructor(){super(...arguments),this.size="md",this.name="uknown",this.networkImagesBySize={sm:Wt,md:Pt,lg:Lt},this.selected=!1,this.round=!1}render(){let t={sm:"4",md:"6",lg:"10"};return this.round?(this.dataset.round="true",this.style.cssText=`
      --local-width: var(--apkt-spacing-10);
      --local-height: var(--apkt-spacing-10);
      --local-icon-size: var(--apkt-spacing-4);
    `):this.style.cssText=`

      --local-path: var(--apkt-path-network-${this.size});
      --local-width:  var(--apkt-width-network-${this.size});
      --local-height:  var(--apkt-height-network-${this.size});
      --local-icon-size:  var(--apkt-spacing-${t[this.size]});
    `,a`${this.templateVisual()} ${this.svgTemplate()} `}svgTemplate(){return this.round?null:this.networkImagesBySize[this.size]}templateVisual(){return this.imageSrc?a`<wui-image src=${this.imageSrc} alt=${this.name}></wui-image>`:a`<wui-icon size="inherit" color="default" name="networkPlaceholder"></wui-icon>`}};Z.styles=[I,Bt];ue([u()],Z.prototype,"size",void 0);ue([u()],Z.prototype,"name",void 0);ue([u({type:Object})],Z.prototype,"networkImagesBySize",void 0);ue([u()],Z.prototype,"imageSrc",void 0);ue([u({type:Boolean})],Z.prototype,"selected",void 0);ue([u({type:Boolean})],Z.prototype,"round",void 0);Z=ue([m("wui-network-image")],Z);var Ft=f`
  :host {
    position: relative;
    display: flex;
    width: 100%;
    height: 1px;
    background-color: ${({tokens:e})=>e.theme.borderPrimary};
    justify-content: center;
    align-items: center;
  }

  :host > wui-text {
    position: absolute;
    padding: 0px 8px;
    transition: background-color ${({durations:e})=>e.lg}
      ${({easings:e})=>e["ease-out-power-2"]};
    will-change: background-color;
  }

  :host([data-bg-color='primary']) > wui-text {
    background-color: ${({tokens:e})=>e.theme.backgroundPrimary};
  }

  :host([data-bg-color='secondary']) > wui-text {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
  }
`;var Ye=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},ve=class extends h{constructor(){super(...arguments),this.text="",this.bgColor="primary"}render(){return this.dataset.bgColor=this.bgColor,a`${this.template()}`}template(){return this.text?a`<wui-text variant="md-regular" color="secondary">${this.text}</wui-text>`:null}};ve.styles=[I,Ft];Ye([u()],ve.prototype,"text",void 0);Ye([u()],ve.prototype,"bgColor",void 0);ve=Ye([m("wui-separator")],ve);var y={INVALID_PAYMENT_CONFIG:"INVALID_PAYMENT_CONFIG",INVALID_RECIPIENT:"INVALID_RECIPIENT",INVALID_ASSET:"INVALID_ASSET",INVALID_AMOUNT:"INVALID_AMOUNT",UNKNOWN_ERROR:"UNKNOWN_ERROR",UNABLE_TO_INITIATE_PAYMENT:"UNABLE_TO_INITIATE_PAYMENT",INVALID_CHAIN_NAMESPACE:"INVALID_CHAIN_NAMESPACE",GENERIC_PAYMENT_ERROR:"GENERIC_PAYMENT_ERROR",UNABLE_TO_GET_EXCHANGES:"UNABLE_TO_GET_EXCHANGES",ASSET_NOT_SUPPORTED:"ASSET_NOT_SUPPORTED",UNABLE_TO_GET_PAY_URL:"UNABLE_TO_GET_PAY_URL",UNABLE_TO_GET_BUY_STATUS:"UNABLE_TO_GET_BUY_STATUS",UNABLE_TO_GET_TOKEN_BALANCES:"UNABLE_TO_GET_TOKEN_BALANCES",UNABLE_TO_GET_QUOTE:"UNABLE_TO_GET_QUOTE",UNABLE_TO_GET_QUOTE_STATUS:"UNABLE_TO_GET_QUOTE_STATUS",INVALID_RECIPIENT_ADDRESS_FOR_ASSET:"INVALID_RECIPIENT_ADDRESS_FOR_ASSET"},J={[y.INVALID_PAYMENT_CONFIG]:"Invalid payment configuration",[y.INVALID_RECIPIENT]:"Invalid recipient address",[y.INVALID_ASSET]:"Invalid asset specified",[y.INVALID_AMOUNT]:"Invalid payment amount",[y.INVALID_RECIPIENT_ADDRESS_FOR_ASSET]:"Invalid recipient address for the asset selected",[y.UNKNOWN_ERROR]:"Unknown payment error occurred",[y.UNABLE_TO_INITIATE_PAYMENT]:"Unable to initiate payment",[y.INVALID_CHAIN_NAMESPACE]:"Invalid chain namespace",[y.GENERIC_PAYMENT_ERROR]:"Unable to process payment",[y.UNABLE_TO_GET_EXCHANGES]:"Unable to get exchanges",[y.ASSET_NOT_SUPPORTED]:"Asset not supported by the selected exchange",[y.UNABLE_TO_GET_PAY_URL]:"Unable to get payment URL",[y.UNABLE_TO_GET_BUY_STATUS]:"Unable to get buy status",[y.UNABLE_TO_GET_TOKEN_BALANCES]:"Unable to get token balances",[y.UNABLE_TO_GET_QUOTE]:"Unable to get quote. Please choose a different token",[y.UNABLE_TO_GET_QUOTE_STATUS]:"Unable to get quote status"},x=class e extends Error{get message(){return J[this.code]}constructor(t,o){super(J[t]),this.name="AppKitPayError",this.code=t,this.details=o,Error.captureStackTrace&&Error.captureStackTrace(this,e)}};var zt="https://rpc.walletconnect.org/v1/json-rpc",Ke="reown_test";function jt(){let{chainNamespace:e}=C.parseCaipNetworkId(d.state.paymentAsset.network);if(!L.isAddress(d.state.recipient,e))throw new x(y.INVALID_RECIPIENT_ADDRESS_FOR_ASSET,`Provide valid recipient address for namespace "${e}"`)}async function qt(e,t,o){if(t!==U.CHAIN.EVM)throw new x(y.INVALID_CHAIN_NAMESPACE);if(!o.fromAddress)throw new x(y.INVALID_PAYMENT_CONFIG,"fromAddress is required for native EVM payments.");let i=typeof o.amount=="string"?parseFloat(o.amount):o.amount;if(isNaN(i))throw new x(y.INVALID_PAYMENT_CONFIG);let n=e.metadata?.decimals??18,r=B.parseUnits(i.toString(),n);if(typeof r!="bigint")throw new x(y.GENERIC_PAYMENT_ERROR);return await B.sendTransaction({chainNamespace:t,to:o.recipient,address:o.fromAddress,value:r,data:"0x"})??void 0}async function Mt(e,t){if(!t.fromAddress)throw new x(y.INVALID_PAYMENT_CONFIG,"fromAddress is required for ERC20 EVM payments.");let o=e.asset,i=t.recipient,n=Number(e.metadata.decimals),r=B.parseUnits(t.amount.toString(),n);if(r===void 0)throw new x(y.GENERIC_PAYMENT_ERROR);return await B.writeContract({fromAddress:t.fromAddress,tokenAddress:o,args:[i,r],method:"transfer",abi:ft.getERC20Abi(o),chainNamespace:U.CHAIN.EVM})??void 0}async function Ht(e,t){if(e!==U.CHAIN.SOLANA)throw new x(y.INVALID_CHAIN_NAMESPACE);if(!t.fromAddress)throw new x(y.INVALID_PAYMENT_CONFIG,"fromAddress is required for Solana payments.");let o=typeof t.amount=="string"?parseFloat(t.amount):t.amount;if(isNaN(o)||o<=0)throw new x(y.INVALID_PAYMENT_CONFIG,"Invalid payment amount.");try{if(!kt.getProvider(e))throw new x(y.GENERIC_PAYMENT_ERROR,"No Solana provider available.");let n=await B.sendTransaction({chainNamespace:U.CHAIN.SOLANA,to:t.recipient,value:o,tokenMint:t.tokenMint});if(!n)throw new x(y.GENERIC_PAYMENT_ERROR,"Transaction failed.");return n}catch(i){throw i instanceof x?i:new x(y.GENERIC_PAYMENT_ERROR,`Solana payment failed: ${i}`)}}async function Vt({sourceToken:e,toToken:t,amount:o,recipient:i}){let n=B.parseUnits(o,e.metadata.decimals),r=B.parseUnits(o,t.metadata.decimals);return Promise.resolve({type:Re,origin:{amount:n?.toString()??"0",currency:e},destination:{amount:r?.toString()??"0",currency:t},fees:[{id:"service",label:"Service Fee",amount:"0",currency:t}],steps:[{requestId:Re,type:"deposit",deposit:{amount:n?.toString()??"0",currency:e.asset,receiver:i}}],timeInSeconds:6})}function Ee(e){if(!e)return null;let t=e.steps[0];return!t||t.type!==Gt?null:t}function Oe(e,t=0){if(!e)return[];let o=e.steps.filter(n=>n.type===Yt),i=o.filter((n,r)=>r+1>t);return o.length>0&&o.length<3?i:[]}var Xe=new xt({baseUrl:L.getApiUrl(),clientId:null}),Qe=class extends Error{};function Vo(){let e=v.getSnapshot().projectId;return`${zt}?projectId=${e}`}function Ze(){let{projectId:e,sdkType:t,sdkVersion:o}=v.state;return{projectId:e,st:t||"appkit",sv:o||"html-wagmi-4.2.2"}}async function Je(e,t){let o=Vo(),{sdkType:i,sdkVersion:n,projectId:r}=v.getSnapshot(),s={jsonrpc:"2.0",id:1,method:e,params:{...t||{},st:i,sv:n,projectId:r}},E=await(await fetch(o,{method:"POST",body:JSON.stringify(s),headers:{"Content-Type":"application/json"}})).json();if(E.error)throw new Qe(E.error.message);return E}async function et(e){return(await Je("reown_getExchanges",e)).result}async function tt(e){return(await Je("reown_getExchangePayUrl",e)).result}async function Kt(e){return(await Je("reown_getExchangeBuyStatus",e)).result}async function Go(e){let t=S.bigNumber(e.amount).times(10**e.toToken.metadata.decimals).toString(),{chainId:o,chainNamespace:i}=C.parseCaipNetworkId(e.sourceToken.network),{chainId:n,chainNamespace:r}=C.parseCaipNetworkId(e.toToken.network),s=e.sourceToken.asset==="native"?qe(i):e.sourceToken.asset,c=e.toToken.asset==="native"?qe(r):e.toToken.asset;return await Xe.post({path:"/appkit/v1/transfers/quote",body:{user:e.address,originChainId:o.toString(),originCurrency:s,destinationChainId:n.toString(),destinationCurrency:c,recipient:e.recipient,amount:t},params:Ze()})}async function Qt(e){let t=R.isLowerCaseMatch(e.sourceToken.network,e.toToken.network),o=R.isLowerCaseMatch(e.sourceToken.asset,e.toToken.asset);return t&&o?Vt(e):Go(e)}async function Xt(e){return await Xe.get({path:"/appkit/v1/transfers/status",params:{requestId:e.requestId,...Ze()}})}async function Zt(e){return await Xe.get({path:`/appkit/v1/transfers/assets/exchanges/${e}`,params:Ze()})}var Yo=["eip155","solana"],Ko={eip155:{native:{assetNamespace:"slip44",assetReference:"60"},defaultTokenNamespace:"erc20"},solana:{native:{assetNamespace:"slip44",assetReference:"501"},defaultTokenNamespace:"token"}},Jt={56:"714",204:"714"};function Ue(e,t){let{chainNamespace:o,chainId:i}=C.parseCaipNetworkId(e),n=Ko[o];if(!n)throw new Error(`Unsupported chain namespace for CAIP-19 formatting: ${o}`);let r=n.native.assetNamespace,s=n.native.assetReference;return t!=="native"?(r=n.defaultTokenNamespace,s=t):o==="eip155"&&Jt[i]&&(s=Jt[i]),`${`${o}:${i}`}/${r}:${s}`}function eo(e){let{chainNamespace:t}=C.parseCaipNetworkId(e);return Yo.includes(t)}function to(e){let o=g.getAllRequestedCaipNetworks().find(n=>n.caipNetworkId===e.chainId),i=e.address;if(!o)throw new Error(`Target network not found for balance chainId "${e.chainId}"`);if(R.isLowerCaseMatch(e.symbol,o.nativeCurrency.symbol))i="native";else if(L.isCaipAddress(i)){let{address:n}=C.parseCaipAddress(i);i=n}else if(!i)throw new Error(`Balance address not found for balance symbol "${e.symbol}"`);return{network:o.caipNetworkId,asset:i,metadata:{name:e.name,symbol:e.symbol,decimals:Number(e.quantity.decimals),logoURI:e.iconUrl},amount:e.quantity.numeric}}function oo(e){return{chainId:e.network,address:`${e.network}:${e.asset}`,symbol:e.metadata.symbol,name:e.metadata.name,iconUrl:e.metadata.logoURI||"",price:0,quantity:{numeric:"0",decimals:e.metadata.decimals.toString()}}}function pe(e){let t=S.bigNumber(e,{safe:!0});return t.lt(.001)?"<0.001":t.round(4).toString()}function ro(e){let o=g.getAllRequestedCaipNetworks().find(i=>i.caipNetworkId===e.network);return o?!!o.testnet:!1}var io=0,ot="unknown",Re="direct-transfer",Gt="deposit",Yt="transaction",l=wt({paymentAsset:{network:"eip155:1",asset:"0x0",metadata:{name:"0x0",symbol:"0x0",decimals:0}},recipient:"0x0",amount:0,isConfigured:!1,error:null,isPaymentInProgress:!1,exchanges:[],isLoading:!1,openInNewTab:!0,redirectUrl:void 0,payWithExchange:void 0,currentPayment:void 0,analyticsSet:!1,paymentId:void 0,choice:"pay",tokenBalances:{[U.CHAIN.EVM]:[],[U.CHAIN.SOLANA]:[]},isFetchingTokenBalances:!1,selectedPaymentAsset:null,quote:void 0,quoteStatus:"waiting",quoteError:null,isFetchingQuote:!1,selectedExchange:void 0,exchangeUrlForQuote:void 0,requestId:void 0}),d={state:l,subscribe(e){return gt(l,()=>e(l))},subscribeKey(e,t){return yt(l,e,t)},async handleOpenPay(e){this.resetState(),this.setPaymentConfig(e),this.initializeAnalytics(),jt(),await this.prepareTokenLogo(),l.isConfigured=!0,D.sendEvent({type:"track",event:"PAY_MODAL_OPEN",properties:{exchanges:l.exchanges,configuration:{network:l.paymentAsset.network,asset:l.paymentAsset.asset,recipient:l.recipient,amount:l.amount}}}),await $.open({view:"Pay"})},resetState(){l.paymentAsset={network:"eip155:1",asset:"0x0",metadata:{name:"0x0",symbol:"0x0",decimals:0}},l.recipient="0x0",l.amount=0,l.isConfigured=!1,l.error=null,l.isPaymentInProgress=!1,l.isLoading=!1,l.currentPayment=void 0,l.selectedExchange=void 0,l.exchangeUrlForQuote=void 0,l.requestId=void 0},resetQuoteState(){l.quote=void 0,l.quoteStatus="waiting",l.quoteError=null,l.isFetchingQuote=!1,l.requestId=void 0},setPaymentConfig(e){if(!e.paymentAsset)throw new x(y.INVALID_PAYMENT_CONFIG);try{l.choice=e.choice??"pay",l.paymentAsset=e.paymentAsset,l.recipient=e.recipient,l.amount=e.amount,l.openInNewTab=e.openInNewTab??!0,l.redirectUrl=e.redirectUrl,l.payWithExchange=e.payWithExchange,l.error=null}catch(t){throw new x(y.INVALID_PAYMENT_CONFIG,t.message)}},setSelectedPaymentAsset(e){l.selectedPaymentAsset=e},setSelectedExchange(e){l.selectedExchange=e},setRequestId(e){l.requestId=e},setPaymentInProgress(e){l.isPaymentInProgress=e},getPaymentAsset(){return l.paymentAsset},getExchanges(){return l.exchanges},async fetchExchanges(){try{l.isLoading=!0;let e=await et({page:io});l.exchanges=e.exchanges.slice(0,2)}catch{throw k.showError(J.UNABLE_TO_GET_EXCHANGES),new x(y.UNABLE_TO_GET_EXCHANGES)}finally{l.isLoading=!1}},async getAvailableExchanges(e){try{let t=e?.asset&&e?.network?Ue(e.network,e.asset):void 0;return await et({page:e?.page??io,asset:t,amount:e?.amount?.toString()})}catch{throw new x(y.UNABLE_TO_GET_EXCHANGES)}},async getPayUrl(e,t,o=!1){try{let i=Number(t.amount),n=await tt({exchangeId:e,asset:Ue(t.network,t.asset),amount:i.toString(),recipient:`${t.network}:${t.recipient}`});return D.sendEvent({type:"track",event:"PAY_EXCHANGE_SELECTED",properties:{source:"pay",exchange:{id:e},configuration:{network:t.network,asset:t.asset,recipient:t.recipient,amount:i},currentPayment:{type:"exchange",exchangeId:e},headless:o}}),o&&(this.initiatePayment(),D.sendEvent({type:"track",event:"PAY_INITIATED",properties:{source:"pay",paymentId:l.paymentId||ot,configuration:{network:t.network,asset:t.asset,recipient:t.recipient,amount:i},currentPayment:{type:"exchange",exchangeId:e}}})),n}catch(i){throw i instanceof Error&&i.message.includes("is not supported")?new x(y.ASSET_NOT_SUPPORTED):new Error(i.message)}},async generateExchangeUrlForQuote({exchangeId:e,paymentAsset:t,amount:o,recipient:i}){let n=await tt({exchangeId:e,asset:Ue(t.network,t.asset),amount:o.toString(),recipient:i});l.exchangeSessionId=n.sessionId,l.exchangeUrlForQuote=n.url},async openPayUrl(e,t,o=!1){try{let i=await this.getPayUrl(e.exchangeId,t,o);if(!i)throw new x(y.UNABLE_TO_GET_PAY_URL);let r=e.openInNewTab??!0?"_blank":"_self";return L.openHref(i.url,r),i}catch(i){throw i instanceof x?l.error=i.message:l.error=J.GENERIC_PAYMENT_ERROR,new x(y.UNABLE_TO_GET_PAY_URL)}},async onTransfer({chainNamespace:e,fromAddress:t,toAddress:o,amount:i,paymentAsset:n}){if(l.currentPayment={type:"wallet",status:"IN_PROGRESS"},!l.isPaymentInProgress)try{this.initiatePayment();let s=g.getAllRequestedCaipNetworks().find(E=>E.caipNetworkId===n.network);if(!s)throw new Error("Target network not found");let c=g.state.activeCaipNetwork;switch(R.isLowerCaseMatch(c?.caipNetworkId,s.caipNetworkId)||await g.switchActiveNetwork(s),e){case U.CHAIN.EVM:n.asset==="native"&&(l.currentPayment.result=await qt(n,e,{recipient:o,amount:i,fromAddress:t})),n.asset.startsWith("0x")&&(l.currentPayment.result=await Mt(n,{recipient:o,amount:i,fromAddress:t})),l.currentPayment.status="SUCCESS";break;case U.CHAIN.SOLANA:l.currentPayment.result=await Ht(e,{recipient:o,amount:i,fromAddress:t,tokenMint:n.asset==="native"?void 0:n.asset}),l.currentPayment.status="SUCCESS";break;default:throw new x(y.INVALID_CHAIN_NAMESPACE)}}catch(r){throw r instanceof x?l.error=r.message:l.error=J.GENERIC_PAYMENT_ERROR,l.currentPayment.status="FAILED",k.showError(l.error),r}finally{l.isPaymentInProgress=!1}},async onSendTransaction(e){try{let{namespace:t,transactionStep:o}=e;d.initiatePayment();let n=g.getAllRequestedCaipNetworks().find(s=>s.caipNetworkId===l.paymentAsset?.network);if(!n)throw new Error("Target network not found");let r=g.state.activeCaipNetwork;if(R.isLowerCaseMatch(r?.caipNetworkId,n.caipNetworkId)||await g.switchActiveNetwork(n),t===U.CHAIN.EVM){let{from:s,to:c,data:E,value:je}=o.transaction;await B.sendTransaction({address:s,to:c,data:E,value:BigInt(je),chainNamespace:t})}else if(t===U.CHAIN.SOLANA){let{instructions:s}=o.transaction;await B.writeSolanaTransaction({instructions:s})}}catch(t){throw t instanceof x?l.error=t.message:l.error=J.GENERIC_PAYMENT_ERROR,k.showError(l.error),t}finally{l.isPaymentInProgress=!1}},getExchangeById(e){return l.exchanges.find(t=>t.id===e)},validatePayConfig(e){let{paymentAsset:t,recipient:o,amount:i}=e;if(!t)throw new x(y.INVALID_PAYMENT_CONFIG);if(!o)throw new x(y.INVALID_RECIPIENT);if(!t.asset)throw new x(y.INVALID_ASSET);if(i==null||i<=0)throw new x(y.INVALID_AMOUNT)},async handlePayWithExchange(e){try{l.currentPayment={type:"exchange",exchangeId:e};let{network:t,asset:o}=l.paymentAsset,i={network:t,asset:o,amount:l.amount,recipient:l.recipient},n=await this.getPayUrl(e,i);if(!n)throw new x(y.UNABLE_TO_INITIATE_PAYMENT);return l.currentPayment.sessionId=n.sessionId,l.currentPayment.status="IN_PROGRESS",l.currentPayment.exchangeId=e,this.initiatePayment(),{url:n.url,openInNewTab:l.openInNewTab}}catch(t){return t instanceof x?l.error=t.message:l.error=J.GENERIC_PAYMENT_ERROR,l.isPaymentInProgress=!1,k.showError(l.error),null}},async getBuyStatus(e,t){try{let o=await Kt({sessionId:t,exchangeId:e});return(o.status==="SUCCESS"||o.status==="FAILED")&&D.sendEvent({type:"track",event:o.status==="SUCCESS"?"PAY_SUCCESS":"PAY_ERROR",properties:{message:o.status==="FAILED"?L.parseError(l.error):void 0,source:"pay",paymentId:l.paymentId||ot,configuration:{network:l.paymentAsset.network,asset:l.paymentAsset.asset,recipient:l.recipient,amount:l.amount},currentPayment:{type:"exchange",exchangeId:l.currentPayment?.exchangeId,sessionId:l.currentPayment?.sessionId,result:o.txHash}}}),o}catch{throw new x(y.UNABLE_TO_GET_BUY_STATUS)}},async fetchTokensFromEOA({caipAddress:e,caipNetwork:t,namespace:o}){if(!e)return[];let{address:i}=C.parseCaipAddress(e),n=t;return o===U.CHAIN.EVM&&(n=void 0),await Me.getMyTokensWithBalance({address:i,caipNetwork:n})},async fetchTokensFromExchange(){if(!l.selectedExchange)return[];let e=await Zt(l.selectedExchange.id),t=Object.values(e.assets).flat();return await Promise.all(t.map(async i=>{let n=oo(i),{chainNamespace:r}=C.parseCaipNetworkId(n.chainId),s=n.address;if(L.isCaipAddress(s)){let{address:E}=C.parseCaipAddress(s);s=E}let c=await A.getImageByToken(s??"",r).catch(()=>{});return n.iconUrl=c??"",n}))},async fetchTokens({caipAddress:e,caipNetwork:t,namespace:o}){try{l.isFetchingTokenBalances=!0;let r=await(!!l.selectedExchange?this.fetchTokensFromExchange():this.fetchTokensFromEOA({caipAddress:e,caipNetwork:t,namespace:o}));l.tokenBalances={...l.tokenBalances,[o]:r}}catch(i){let n=i instanceof Error?i.message:"Unable to get token balances";k.showError(n)}finally{l.isFetchingTokenBalances=!1}},async fetchQuote({amount:e,address:t,sourceToken:o,toToken:i,recipient:n}){try{d.resetQuoteState(),l.isFetchingQuote=!0;let r=await Qt({amount:e,address:l.selectedExchange?void 0:t,sourceToken:o,toToken:i,recipient:n});if(l.selectedExchange){let s=Ee(r);if(s){let c=`${o.network}:${s.deposit.receiver}`,E=S.formatNumber(s.deposit.amount,{decimals:o.metadata.decimals??0,round:8});await d.generateExchangeUrlForQuote({exchangeId:l.selectedExchange.id,paymentAsset:o,amount:E.toString(),recipient:c})}}l.quote=r}catch(r){let s=J.UNABLE_TO_GET_QUOTE;if(r instanceof Error&&r.cause&&r.cause instanceof Response)try{let c=await r.cause.json();c.error&&typeof c.error=="string"&&(s=c.error)}catch{}throw l.quoteError=s,k.showError(s),new x(y.UNABLE_TO_GET_QUOTE)}finally{l.isFetchingQuote=!1}},async fetchQuoteStatus({requestId:e}){try{if(e===Re){let o=l.selectedExchange,i=l.exchangeSessionId;if(o&&i){switch((await this.getBuyStatus(o.id,i)).status){case"IN_PROGRESS":l.quoteStatus="waiting";break;case"SUCCESS":l.quoteStatus="success",l.isPaymentInProgress=!1;break;case"FAILED":l.quoteStatus="failure",l.isPaymentInProgress=!1;break;case"UNKNOWN":l.quoteStatus="waiting";break;default:l.quoteStatus="waiting";break}return}l.quoteStatus="success";return}let{status:t}=await Xt({requestId:e});l.quoteStatus=t}catch{throw l.quoteStatus="failure",new x(y.UNABLE_TO_GET_QUOTE_STATUS)}},initiatePayment(){l.isPaymentInProgress=!0,l.paymentId=crypto.randomUUID()},initializeAnalytics(){l.analyticsSet||(l.analyticsSet=!0,this.subscribeKey("isPaymentInProgress",e=>{if(l.currentPayment?.status&&l.currentPayment.status!=="UNKNOWN"){let t={IN_PROGRESS:"PAY_INITIATED",SUCCESS:"PAY_SUCCESS",FAILED:"PAY_ERROR"}[l.currentPayment.status];D.sendEvent({type:"track",event:t,properties:{message:l.currentPayment.status==="FAILED"?L.parseError(l.error):void 0,source:"pay",paymentId:l.paymentId||ot,configuration:{network:l.paymentAsset.network,asset:l.paymentAsset.asset,recipient:l.recipient,amount:l.amount},currentPayment:{type:l.currentPayment.type,exchangeId:l.currentPayment.exchangeId,sessionId:l.currentPayment.sessionId,result:l.currentPayment.result}}})}}))},async prepareTokenLogo(){if(!l.paymentAsset.metadata.logoURI)try{let{chainNamespace:e}=C.parseCaipNetworkId(l.paymentAsset.network),t=await A.getImageByToken(l.paymentAsset.asset,e);l.paymentAsset.metadata.logoURI=t}catch{}}};var no=f`
  wui-separator {
    margin: var(--apkt-spacing-3) calc(var(--apkt-spacing-3) * -1) var(--apkt-spacing-2)
      calc(var(--apkt-spacing-3) * -1);
    width: calc(100% + var(--apkt-spacing-3) * 2);
  }

  .token-display {
    padding: var(--apkt-spacing-3) var(--apkt-spacing-3);
    border-radius: var(--apkt-borderRadius-5);
    background-color: var(--apkt-tokens-theme-backgroundPrimary);
    margin-top: var(--apkt-spacing-3);
    margin-bottom: var(--apkt-spacing-3);
  }

  .token-display wui-text {
    text-transform: none;
  }

  wui-loading-spinner {
    padding: var(--apkt-spacing-2);
  }

  .left-image-container {
    position: relative;
    justify-content: center;
    align-items: center;
  }

  .token-image {
    border-radius: ${({borderRadius:e})=>e.round};
    width: 40px;
    height: 40px;
  }

  .chain-image {
    position: absolute;
    width: 20px;
    height: 20px;
    bottom: -3px;
    right: -5px;
    border-radius: ${({borderRadius:e})=>e.round};
    border: 2px solid ${({tokens:e})=>e.theme.backgroundPrimary};
  }

  .payment-methods-container {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    border-top-right-radius: ${({borderRadius:e})=>e[8]};
    border-top-left-radius: ${({borderRadius:e})=>e[8]};
  }
`;var ae=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},V=class extends h{constructor(){super(),this.unsubscribe=[],this.amount=d.state.amount,this.namespace=void 0,this.paymentAsset=d.state.paymentAsset,this.activeConnectorIds=P.state.activeConnectorIds,this.caipAddress=void 0,this.exchanges=d.state.exchanges,this.isLoading=d.state.isLoading,this.initializeNamespace(),this.unsubscribe.push(d.subscribeKey("amount",t=>this.amount=t)),this.unsubscribe.push(P.subscribeKey("activeConnectorIds",t=>this.activeConnectorIds=t)),this.unsubscribe.push(d.subscribeKey("exchanges",t=>this.exchanges=t)),this.unsubscribe.push(d.subscribeKey("isLoading",t=>this.isLoading=t)),d.fetchExchanges(),d.setSelectedExchange(void 0)}disconnectedCallback(){this.unsubscribe.forEach(t=>t())}render(){return a`
      <wui-flex flexDirection="column">
        ${this.paymentDetailsTemplate()} ${this.paymentMethodsTemplate()}
      </wui-flex>
    `}paymentMethodsTemplate(){return a`
      <wui-flex flexDirection="column" padding="3" gap="2" class="payment-methods-container">
        ${this.payWithWalletTemplate()} ${this.templateSeparator()}
        ${this.templateExchangeOptions()}
      </wui-flex>
    `}initializeNamespace(){let t=g.state.activeChain;this.namespace=t,this.caipAddress=g.getAccountData(t)?.caipAddress,this.unsubscribe.push(g.subscribeChainProp("accountState",o=>{this.caipAddress=o?.caipAddress},t))}paymentDetailsTemplate(){let o=g.getAllRequestedCaipNetworks().find(i=>i.caipNetworkId===this.paymentAsset.network);return a`
      <wui-flex
        alignItems="center"
        justifyContent="space-between"
        .padding=${["6","8","6","8"]}
        gap="2"
      >
        <wui-flex alignItems="center" gap="1">
          <wui-text variant="h1-regular" color="primary">
            ${pe(this.amount||"0")}
          </wui-text>

          <wui-flex flexDirection="column">
            <wui-text variant="h6-regular" color="secondary">
              ${this.paymentAsset.metadata.symbol||"Unknown"}
            </wui-text>
            <wui-text variant="md-medium" color="secondary"
              >on ${o?.name||"Unknown"}</wui-text
            >
          </wui-flex>
        </wui-flex>

        <wui-flex class="left-image-container">
          <wui-image
            src=${b(this.paymentAsset.metadata.logoURI)}
            class="token-image"
          ></wui-image>
          <wui-image
            src=${b(A.getNetworkImage(o))}
            class="chain-image"
          ></wui-image>
        </wui-flex>
      </wui-flex>
    `}payWithWalletTemplate(){return eo(this.paymentAsset.network)?this.caipAddress?this.connectedWalletTemplate():this.disconnectedWalletTemplate():a``}connectedWalletTemplate(){let{name:t,image:o}=this.getWalletProperties({namespace:this.namespace});return a`
      <wui-flex flexDirection="column" gap="3">
        <wui-list-item
          type="secondary"
          boxColor="foregroundSecondary"
          @click=${this.onWalletPayment}
          .boxed=${!1}
          ?chevron=${!0}
          ?fullSize=${!1}
          ?rounded=${!0}
          data-testid="wallet-payment-option"
          imageSrc=${b(o)}
          imageSize="3xl"
        >
          <wui-text variant="lg-regular" color="primary">Pay with ${t}</wui-text>
        </wui-list-item>

        <wui-list-item
          type="secondary"
          icon="power"
          iconColor="error"
          @click=${this.onDisconnect}
          data-testid="disconnect-button"
          ?chevron=${!1}
          boxColor="foregroundSecondary"
        >
          <wui-text variant="lg-regular" color="secondary">Disconnect</wui-text>
        </wui-list-item>
      </wui-flex>
    `}disconnectedWalletTemplate(){return a`<wui-list-item
      type="secondary"
      boxColor="foregroundSecondary"
      variant="icon"
      iconColor="default"
      iconVariant="overlay"
      icon="wallet"
      @click=${this.onWalletPayment}
      ?chevron=${!0}
      data-testid="wallet-payment-option"
    >
      <wui-text variant="lg-regular" color="primary">Pay with wallet</wui-text>
    </wui-list-item>`}templateExchangeOptions(){if(this.isLoading)return a`<wui-flex justifyContent="center" alignItems="center">
        <wui-loading-spinner size="md"></wui-loading-spinner>
      </wui-flex>`;let t=this.exchanges.filter(o=>ro(this.paymentAsset)?o.id===Ke:o.id!==Ke);return t.length===0?a`<wui-flex justifyContent="center" alignItems="center">
        <wui-text variant="md-medium" color="primary">No exchanges available</wui-text>
      </wui-flex>`:t.map(o=>a`
        <wui-list-item
          type="secondary"
          boxColor="foregroundSecondary"
          @click=${()=>this.onExchangePayment(o)}
          data-testid="exchange-option-${o.id}"
          ?chevron=${!0}
          imageSrc=${b(o.imageUrl)}
        >
          <wui-text flexGrow="1" variant="lg-regular" color="primary">
            Pay with ${o.name}
          </wui-text>
        </wui-list-item>
      `)}templateSeparator(){return a`<wui-separator text="or" bgColor="secondary"></wui-separator>`}async onWalletPayment(){if(!this.namespace)throw new Error("Namespace not found");this.caipAddress?w.push("PayQuote"):(await P.connect(),await $.open({view:"PayQuote"}))}onExchangePayment(t){d.setSelectedExchange(t),w.push("PayQuote")}async onDisconnect(){try{await B.disconnect(),await $.open({view:"Pay"})}catch{console.error("Failed to disconnect"),k.showError("Failed to disconnect")}}getWalletProperties({namespace:t}){if(!t)return{name:void 0,image:void 0};let o=this.activeConnectorIds[t];if(!o)return{name:void 0,image:void 0};let i=P.getConnector({id:o,namespace:t});if(!i)return{name:void 0,image:void 0};let n=A.getConnectorImage(i);return{name:i.name,image:n}}};V.styles=no;ae([p()],V.prototype,"amount",void 0);ae([p()],V.prototype,"namespace",void 0);ae([p()],V.prototype,"paymentAsset",void 0);ae([p()],V.prototype,"activeConnectorIds",void 0);ae([p()],V.prototype,"caipAddress",void 0);ae([p()],V.prototype,"exchanges",void 0);ae([p()],V.prototype,"isLoading",void 0);V=ae([m("w3m-pay-view")],V);var so=f`
  :host {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .pulse-container {
    position: relative;
    width: var(--pulse-size);
    height: var(--pulse-size);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .pulse-rings {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .pulse-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 2px solid var(--pulse-color);
    opacity: 0;
    animation: pulse var(--pulse-duration, 2s) ease-out infinite;
  }

  .pulse-content {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  @keyframes pulse {
    0% {
      transform: scale(0.5);
      opacity: var(--pulse-opacity, 0.3);
    }
    50% {
      opacity: calc(var(--pulse-opacity, 0.3) * 0.5);
    }
    100% {
      transform: scale(1.2);
      opacity: 0;
    }
  }
`;var ge=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},Qo=3,Xo=2,Zo=.3,Jo="200px",er={"accent-primary":te.tokens.core.backgroundAccentPrimary},ce=class extends h{constructor(){super(...arguments),this.rings=Qo,this.duration=Xo,this.opacity=Zo,this.size=Jo,this.variant="accent-primary"}render(){let t=er[this.variant];this.style.cssText=`
      --pulse-size: ${this.size};
      --pulse-duration: ${this.duration}s;
      --pulse-color: ${t};
      --pulse-opacity: ${this.opacity};
    `;let o=Array.from({length:this.rings},(i,n)=>this.renderRing(n,this.rings));return a`
      <div class="pulse-container">
        <div class="pulse-rings">${o}</div>
        <div class="pulse-content">
          <slot></slot>
        </div>
      </div>
    `}renderRing(t,o){let n=`animation-delay: ${t/o*this.duration}s;`;return a`<div class="pulse-ring" style=${n}></div>`}};ce.styles=[I,so];ge([u({type:Number})],ce.prototype,"rings",void 0);ge([u({type:Number})],ce.prototype,"duration",void 0);ge([u({type:Number})],ce.prototype,"opacity",void 0);ge([u()],ce.prototype,"size",void 0);ge([u()],ce.prototype,"variant",void 0);ce=ge([m("wui-pulse")],ce);var rt=[{id:"received",title:"Receiving funds",icon:"dollar"},{id:"processing",title:"Swapping asset",icon:"recycleHorizontal"},{id:"sending",title:"Sending asset to the recipient address",icon:"send"}],it=["success","submitted","failure","timeout","refund"];var ao=f`
  :host {
    display: block;
    height: 100%;
    width: 100%;
  }

  wui-image {
    border-radius: ${({borderRadius:e})=>e.round};
  }

  .token-badge-container {
    position: absolute;
    bottom: 6px;
    left: 50%;
    transform: translateX(-50%);
    border-radius: ${({borderRadius:e})=>e[4]};
    z-index: 3;
    min-width: 105px;
  }

  .token-badge-container.loading {
    background-color: ${({tokens:e})=>e.theme.backgroundPrimary};
    border: 3px solid ${({tokens:e})=>e.theme.backgroundPrimary};
  }

  .token-badge-container.success {
    background-color: ${({tokens:e})=>e.theme.backgroundPrimary};
    border: 3px solid ${({tokens:e})=>e.theme.backgroundPrimary};
  }

  .token-image-container {
    position: relative;
  }

  .token-image {
    border-radius: ${({borderRadius:e})=>e.round};
    width: 64px;
    height: 64px;
  }

  .token-image.success {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
  }

  .token-image.error {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
  }

  .token-image.loading {
    background: ${({colors:e})=>e.accent010};
  }

  .token-image wui-icon {
    width: 32px;
    height: 32px;
  }

  .token-badge {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    border: 1px solid ${({tokens:e})=>e.theme.foregroundSecondary};
    border-radius: ${({borderRadius:e})=>e[4]};
  }

  .token-badge wui-text {
    white-space: nowrap;
  }

  .payment-lifecycle-container {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    border-top-right-radius: ${({borderRadius:e})=>e[6]};
    border-top-left-radius: ${({borderRadius:e})=>e[6]};
  }

  .payment-step-badge {
    padding: ${({spacing:e})=>e[1]} ${({spacing:e})=>e[2]};
    border-radius: ${({borderRadius:e})=>e[1]};
  }

  .payment-step-badge.loading {
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
  }

  .payment-step-badge.error {
    background-color: ${({tokens:e})=>e.core.backgroundError};
  }

  .payment-step-badge.success {
    background-color: ${({tokens:e})=>e.core.backgroundSuccess};
  }

  .step-icon-container {
    position: relative;
    height: 40px;
    width: 40px;
    border-radius: ${({borderRadius:e})=>e.round};
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
  }

  .step-icon-box {
    position: absolute;
    right: -4px;
    bottom: -1px;
    padding: 2px;
    border-radius: ${({borderRadius:e})=>e.round};
    border: 2px solid ${({tokens:e})=>e.theme.backgroundPrimary};
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
  }

  .step-icon-box.success {
    background-color: ${({tokens:e})=>e.core.backgroundSuccess};
  }
`;var G=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},tr={received:["pending","success","submitted"],processing:["success","submitted"],sending:["success","submitted"]},or=3e3,j=class extends h{constructor(){super(),this.unsubscribe=[],this.pollingInterval=null,this.paymentAsset=d.state.paymentAsset,this.quoteStatus=d.state.quoteStatus,this.quote=d.state.quote,this.amount=d.state.amount,this.namespace=void 0,this.caipAddress=void 0,this.profileName=null,this.activeConnectorIds=P.state.activeConnectorIds,this.selectedExchange=d.state.selectedExchange,this.initializeNamespace(),this.unsubscribe.push(d.subscribeKey("quoteStatus",t=>this.quoteStatus=t),d.subscribeKey("quote",t=>this.quote=t),P.subscribeKey("activeConnectorIds",t=>this.activeConnectorIds=t),d.subscribeKey("selectedExchange",t=>this.selectedExchange=t))}connectedCallback(){super.connectedCallback(),this.startPolling()}disconnectedCallback(){super.disconnectedCallback(),this.stopPolling(),this.unsubscribe.forEach(t=>t())}render(){return a`
      <wui-flex flexDirection="column" .padding=${["3","0","0","0"]} gap="2">
        ${this.tokenTemplate()} ${this.paymentTemplate()} ${this.paymentLifecycleTemplate()}
      </wui-flex>
    `}tokenTemplate(){let t=pe(this.amount||"0"),o=this.paymentAsset.metadata.symbol??"Unknown",n=g.getAllRequestedCaipNetworks().find(c=>c.caipNetworkId===this.paymentAsset.network),r=this.quoteStatus==="failure"||this.quoteStatus==="timeout"||this.quoteStatus==="refund";return this.quoteStatus==="success"||this.quoteStatus==="submitted"?a`<wui-flex alignItems="center" justifyContent="center">
        <wui-flex justifyContent="center" alignItems="center" class="token-image success">
          <wui-icon name="checkmark" color="success" size="inherit"></wui-icon>
        </wui-flex>
      </wui-flex>`:r?a`<wui-flex alignItems="center" justifyContent="center">
        <wui-flex justifyContent="center" alignItems="center" class="token-image error">
          <wui-icon name="close" color="error" size="inherit"></wui-icon>
        </wui-flex>
      </wui-flex>`:a`
      <wui-flex alignItems="center" justifyContent="center">
        <wui-flex class="token-image-container">
          <wui-pulse size="125px" rings="3" duration="4" opacity="0.5" variant="accent-primary">
            <wui-flex justifyContent="center" alignItems="center" class="token-image loading">
              <wui-icon name="paperPlaneTitle" color="accent-primary" size="inherit"></wui-icon>
            </wui-flex>
          </wui-pulse>

          <wui-flex
            justifyContent="center"
            alignItems="center"
            class="token-badge-container loading"
          >
            <wui-flex
              alignItems="center"
              justifyContent="center"
              gap="01"
              padding="1"
              class="token-badge"
            >
              <wui-image
                src=${b(A.getNetworkImage(n))}
                class="chain-image"
                size="mdl"
              ></wui-image>

              <wui-text variant="lg-regular" color="primary">${t} ${o}</wui-text>
            </wui-flex>
          </wui-flex>
        </wui-flex>
      </wui-flex>
    `}paymentTemplate(){return a`
      <wui-flex flexDirection="column" gap="2" .padding=${["0","6","0","6"]}>
        ${this.renderPayment()}
        <wui-separator></wui-separator>
        ${this.renderWallet()}
      </wui-flex>
    `}paymentLifecycleTemplate(){let t=this.getStepsWithStatus();return a`
      <wui-flex flexDirection="column" padding="4" gap="2" class="payment-lifecycle-container">
        <wui-flex alignItems="center" justifyContent="space-between">
          <wui-text variant="md-regular" color="secondary">PAYMENT CYCLE</wui-text>

          ${this.renderPaymentCycleBadge()}
        </wui-flex>

        <wui-flex flexDirection="column" gap="5" .padding=${["2","0","2","0"]}>
          ${t.map(o=>this.renderStep(o))}
        </wui-flex>
      </wui-flex>
    `}renderPaymentCycleBadge(){let t=this.quoteStatus==="failure"||this.quoteStatus==="timeout"||this.quoteStatus==="refund",o=this.quoteStatus==="success"||this.quoteStatus==="submitted";if(t)return a`
        <wui-flex
          justifyContent="center"
          alignItems="center"
          class="payment-step-badge error"
          gap="1"
        >
          <wui-icon name="close" color="error" size="xs"></wui-icon>
          <wui-text variant="sm-regular" color="error">Failed</wui-text>
        </wui-flex>
      `;if(o)return a`
        <wui-flex
          justifyContent="center"
          alignItems="center"
          class="payment-step-badge success"
          gap="1"
        >
          <wui-icon name="checkmark" color="success" size="xs"></wui-icon>
          <wui-text variant="sm-regular" color="success">Completed</wui-text>
        </wui-flex>
      `;let i=this.quote?.timeInSeconds??0;return a`
      <wui-flex alignItems="center" justifyContent="space-between" gap="3">
        <wui-flex
          justifyContent="center"
          alignItems="center"
          class="payment-step-badge loading"
          gap="1"
        >
          <wui-icon name="clock" color="default" size="xs"></wui-icon>
          <wui-text variant="sm-regular" color="primary">Est. ${i} sec</wui-text>
        </wui-flex>

        <wui-icon name="chevronBottom" color="default" size="xxs"></wui-icon>
      </wui-flex>
    `}renderPayment(){let o=g.getAllRequestedCaipNetworks().find(s=>{let c=this.quote?.origin.currency.network;if(!c)return!1;let{chainId:E}=C.parseCaipNetworkId(c);return R.isLowerCaseMatch(s.id.toString(),E.toString())}),i=S.formatNumber(this.quote?.origin.amount||"0",{decimals:this.quote?.origin.currency.metadata.decimals??0}).toString(),n=pe(i),r=this.quote?.origin.currency.metadata.symbol??"Unknown";return a`
      <wui-flex
        alignItems="flex-start"
        justifyContent="space-between"
        .padding=${["3","0","3","0"]}
      >
        <wui-text variant="lg-regular" color="secondary">Payment Method</wui-text>

        <wui-flex flexDirection="column" alignItems="flex-end" gap="1">
          <wui-flex alignItems="center" gap="01">
            <wui-text variant="lg-regular" color="primary">${n}</wui-text>
            <wui-text variant="lg-regular" color="secondary">${r}</wui-text>
          </wui-flex>

          <wui-flex alignItems="center" gap="1">
            <wui-text variant="md-regular" color="secondary">on</wui-text>
            <wui-image
              src=${b(A.getNetworkImage(o))}
              size="xs"
            ></wui-image>
            <wui-text variant="md-regular" color="secondary">${o?.name}</wui-text>
          </wui-flex>
        </wui-flex>
      </wui-flex>
    `}renderWallet(){return a`
      <wui-flex
        alignItems="flex-start"
        justifyContent="space-between"
        .padding=${["3","0","3","0"]}
      >
        <wui-text variant="lg-regular" color="secondary"
          >${this.selectedExchange?"Exchange":"Wallet"}</wui-text
        >

        ${this.renderWalletText()}
      </wui-flex>
    `}renderWalletText(){let{image:t}=this.getWalletProperties({namespace:this.namespace}),{address:o}=this.caipAddress?C.parseCaipAddress(this.caipAddress):{},i=this.selectedExchange?.name;return this.selectedExchange?a`
        <wui-flex alignItems="center" justifyContent="flex-end" gap="1">
          <wui-text variant="lg-regular" color="primary">${i}</wui-text>
          <wui-image src=${b(this.selectedExchange.imageUrl)} size="mdl"></wui-image>
        </wui-flex>
      `:a`
      <wui-flex alignItems="center" justifyContent="flex-end" gap="1">
        <wui-text variant="lg-regular" color="primary">
          ${re.getTruncateString({string:this.profileName||o||i||"",charsStart:this.profileName?16:4,charsEnd:this.profileName?0:6,truncate:this.profileName?"end":"middle"})}
        </wui-text>

        <wui-image src=${b(t)} size="mdl"></wui-image>
      </wui-flex>
    `}getStepsWithStatus(){return this.quoteStatus==="failure"||this.quoteStatus==="timeout"||this.quoteStatus==="refund"?rt.map(o=>({...o,status:"failed"})):rt.map(o=>{let n=(tr[o.id]??[]).includes(this.quoteStatus)?"completed":"pending";return{...o,status:n}})}renderStep({title:t,icon:o,status:i}){return a`
      <wui-flex alignItems="center" gap="3">
        <wui-flex justifyContent="center" alignItems="center" class="step-icon-container">
          <wui-icon name=${o} color="default" size="mdl"></wui-icon>

          <wui-flex alignItems="center" justifyContent="center" class=${$e({"step-icon-box":!0,success:i==="completed"})}>
            ${this.renderStatusIndicator(i)}
          </wui-flex>
        </wui-flex>

        <wui-text variant="md-regular" color="primary">${t}</wui-text>
      </wui-flex>
    `}renderStatusIndicator(t){return t==="completed"?a`<wui-icon size="sm" color="success" name="checkmark"></wui-icon>`:t==="failed"?a`<wui-icon size="sm" color="error" name="close"></wui-icon>`:t==="pending"?a`<wui-loading-spinner color="accent-primary" size="sm"></wui-loading-spinner>`:null}startPolling(){this.pollingInterval||(this.fetchQuoteStatus(),this.pollingInterval=setInterval(()=>{this.fetchQuoteStatus()},or))}stopPolling(){this.pollingInterval&&(clearInterval(this.pollingInterval),this.pollingInterval=null)}async fetchQuoteStatus(){let t=d.state.requestId;if(!t||it.includes(this.quoteStatus))this.stopPolling();else try{await d.fetchQuoteStatus({requestId:t}),it.includes(this.quoteStatus)&&this.stopPolling()}catch{this.stopPolling()}}initializeNamespace(){let t=g.state.activeChain;this.namespace=t,this.caipAddress=g.getAccountData(t)?.caipAddress,this.profileName=g.getAccountData(t)?.profileName??null,this.unsubscribe.push(g.subscribeChainProp("accountState",o=>{this.caipAddress=o?.caipAddress,this.profileName=o?.profileName??null},t))}getWalletProperties({namespace:t}){if(!t)return{name:void 0,image:void 0};let o=this.activeConnectorIds[t];if(!o)return{name:void 0,image:void 0};let i=P.getConnector({id:o,namespace:t});if(!i)return{name:void 0,image:void 0};let n=A.getConnectorImage(i);return{name:i.name,image:n}}};j.styles=ao;G([p()],j.prototype,"paymentAsset",void 0);G([p()],j.prototype,"quoteStatus",void 0);G([p()],j.prototype,"quote",void 0);G([p()],j.prototype,"amount",void 0);G([p()],j.prototype,"namespace",void 0);G([p()],j.prototype,"caipAddress",void 0);G([p()],j.prototype,"profileName",void 0);G([p()],j.prototype,"activeConnectorIds",void 0);G([p()],j.prototype,"selectedExchange",void 0);j=G([m("w3m-pay-loading-view")],j);var co=f`
  button {
    display: flex;
    align-items: center;
    height: 40px;
    padding: ${({spacing:e})=>e[2]};
    border-radius: ${({borderRadius:e})=>e[4]};
    column-gap: ${({spacing:e})=>e[1]};
    background-color: transparent;
    transition: background-color ${({durations:e})=>e.lg}
      ${({easings:e})=>e["ease-out-power-2"]};
    will-change: background-color;
  }

  wui-image,
  .icon-box {
    width: ${({spacing:e})=>e[6]};
    height: ${({spacing:e})=>e[6]};
    border-radius: ${({borderRadius:e})=>e[4]};
  }

  wui-text {
    flex: 1;
  }

  .icon-box {
    position: relative;
  }

  .icon-box[data-active='true'] {
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
  }

  .circle {
    position: absolute;
    left: 16px;
    top: 15px;
    width: 8px;
    height: 8px;
    background-color: ${({tokens:e})=>e.core.textSuccess};
    box-shadow: 0 0 0 2px ${({tokens:e})=>e.theme.foregroundPrimary};
    border-radius: 50%;
  }

  /* -- Hover & Active states ----------------------------------------------------------- */
  @media (hover: hover) {
    button:hover:enabled,
    button:active:enabled {
      background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    }
  }
`;var M=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},F=class extends h{constructor(){super(...arguments),this.address="",this.profileName="",this.alt="",this.imageSrc="",this.icon=void 0,this.iconSize="md",this.enableGreenCircle=!0,this.loading=!1,this.charsStart=4,this.charsEnd=6}render(){return a`
      <button>
        ${this.leftImageTemplate()} ${this.textTemplate()} ${this.rightImageTemplate()}
      </button>
    `}leftImageTemplate(){let t=this.icon?a`<wui-icon
          size=${b(this.iconSize)}
          color="default"
          name=${this.icon}
          class="icon"
        ></wui-icon>`:a`<wui-image src=${this.imageSrc} alt=${this.alt}></wui-image>`;return a`
      <wui-flex
        alignItems="center"
        justifyContent="center"
        class="icon-box"
        data-active=${!!this.icon}
      >
        ${t}
        ${this.enableGreenCircle?a`<wui-flex class="circle"></wui-flex>`:null}
      </wui-flex>
    `}textTemplate(){return a`
      <wui-text variant="lg-regular" color="primary">
        ${re.getTruncateString({string:this.profileName||this.address,charsStart:this.profileName?16:this.charsStart,charsEnd:this.profileName?0:this.charsEnd,truncate:this.profileName?"end":"middle"})}
      </wui-text>
    `}rightImageTemplate(){return a`<wui-icon name="chevronBottom" size="sm" color="default"></wui-icon>`}};F.styles=[I,oe,co];M([u()],F.prototype,"address",void 0);M([u()],F.prototype,"profileName",void 0);M([u()],F.prototype,"alt",void 0);M([u()],F.prototype,"imageSrc",void 0);M([u()],F.prototype,"icon",void 0);M([u()],F.prototype,"iconSize",void 0);M([u({type:Boolean})],F.prototype,"enableGreenCircle",void 0);M([u({type:Boolean})],F.prototype,"loading",void 0);M([u({type:Number})],F.prototype,"charsStart",void 0);M([u({type:Number})],F.prototype,"charsEnd",void 0);F=M([m("wui-wallet-switch")],F);var lo=ee`
  :host {
    display: block;
  }
`;var rr=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},nt=class extends h{render(){return a`
      <wui-flex flexDirection="column" gap="4">
        <wui-flex alignItems="center" justifyContent="space-between">
          <wui-text variant="md-regular" color="secondary">Pay</wui-text>
          <wui-shimmer width="60px" height="16px" borderRadius="4xs" variant="light"></wui-shimmer>
        </wui-flex>

        <wui-flex alignItems="center" justifyContent="space-between">
          <wui-text variant="md-regular" color="secondary">Network Fee</wui-text>

          <wui-flex flexDirection="column" alignItems="flex-end" gap="2">
            <wui-shimmer
              width="75px"
              height="16px"
              borderRadius="4xs"
              variant="light"
            ></wui-shimmer>

            <wui-flex alignItems="center" gap="01">
              <wui-shimmer width="14px" height="14px" rounded variant="light"></wui-shimmer>
              <wui-shimmer
                width="49px"
                height="14px"
                borderRadius="4xs"
                variant="light"
              ></wui-shimmer>
            </wui-flex>
          </wui-flex>
        </wui-flex>

        <wui-flex alignItems="center" justifyContent="space-between">
          <wui-text variant="md-regular" color="secondary">Service Fee</wui-text>
          <wui-shimmer width="75px" height="16px" borderRadius="4xs" variant="light"></wui-shimmer>
        </wui-flex>
      </wui-flex>
    `}};nt.styles=[lo];nt=rr([m("w3m-pay-fees-skeleton")],nt);var uo=f`
  :host {
    display: block;
  }

  wui-image {
    border-radius: ${({borderRadius:e})=>e.round};
  }
`;var po=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},De=class extends h{constructor(){super(),this.unsubscribe=[],this.quote=d.state.quote,this.unsubscribe.push(d.subscribeKey("quote",t=>this.quote=t))}disconnectedCallback(){this.unsubscribe.forEach(t=>t())}render(){let t=S.formatNumber(this.quote?.origin.amount||"0",{decimals:this.quote?.origin.currency.metadata.decimals??0,round:6}).toString();return a`
      <wui-flex flexDirection="column" gap="4">
        <wui-flex alignItems="center" justifyContent="space-between">
          <wui-text variant="md-regular" color="secondary">Pay</wui-text>
          <wui-text variant="md-regular" color="primary">
            ${t} ${this.quote?.origin.currency.metadata.symbol||"Unknown"}
          </wui-text>
        </wui-flex>

        ${this.quote&&this.quote.fees.length>0?this.quote.fees.map(o=>this.renderFee(o)):null}
      </wui-flex>
    `}renderFee(t){let o=t.id==="network",i=S.formatNumber(t.amount||"0",{decimals:t.currency.metadata.decimals??0,round:6}).toString();if(o){let r=g.getAllRequestedCaipNetworks().find(s=>R.isLowerCaseMatch(s.caipNetworkId,t.currency.network));return a`
        <wui-flex alignItems="center" justifyContent="space-between">
          <wui-text variant="md-regular" color="secondary">${t.label}</wui-text>

          <wui-flex flexDirection="column" alignItems="flex-end" gap="2">
            <wui-text variant="md-regular" color="primary">
              ${i} ${t.currency.metadata.symbol||"Unknown"}
            </wui-text>

            <wui-flex alignItems="center" gap="01">
              <wui-image
                src=${b(A.getNetworkImage(r))}
                size="xs"
              ></wui-image>
              <wui-text variant="sm-regular" color="secondary">
                ${r?.name||"Unknown"}
              </wui-text>
            </wui-flex>
          </wui-flex>
        </wui-flex>
      `}return a`
      <wui-flex alignItems="center" justifyContent="space-between">
        <wui-text variant="md-regular" color="secondary">${t.label}</wui-text>
        <wui-text variant="md-regular" color="primary">
          ${i} ${t.currency.metadata.symbol||"Unknown"}
        </wui-text>
      </wui-flex>
    `}};De.styles=[uo];po([p()],De.prototype,"quote",void 0);De=po([m("w3m-pay-fees")],De);var mo=f`
  :host {
    display: block;
    width: 100%;
  }

  .disabled-container {
    padding: ${({spacing:e})=>e[2]};
    min-height: 168px;
  }

  wui-icon {
    width: ${({spacing:e})=>e[8]};
    height: ${({spacing:e})=>e[8]};
  }

  wui-flex > wui-text {
    max-width: 273px;
  }
`;var ho=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},Le=class extends h{constructor(){super(),this.unsubscribe=[],this.selectedExchange=d.state.selectedExchange,this.unsubscribe.push(d.subscribeKey("selectedExchange",t=>this.selectedExchange=t))}disconnectedCallback(){this.unsubscribe.forEach(t=>t())}render(){let t=!!this.selectedExchange;return a`
      <wui-flex
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        gap="3"
        class="disabled-container"
      >
        <wui-icon name="coins" color="default" size="inherit"></wui-icon>

        <wui-text variant="md-regular" color="primary" align="center">
          You don't have enough funds to complete this transaction
        </wui-text>

        ${t?null:a`<wui-button
              size="md"
              variant="neutral-secondary"
              @click=${this.dispatchConnectOtherWalletEvent.bind(this)}
              >Connect other wallet</wui-button
            >`}
      </wui-flex>
    `}dispatchConnectOtherWalletEvent(){this.dispatchEvent(new CustomEvent("connectOtherWallet",{detail:!0,bubbles:!0,composed:!0}))}};Le.styles=[mo];ho([u({type:Array})],Le.prototype,"selectedExchange",void 0);Le=ho([m("w3m-pay-options-empty")],Le);var fo=f`
  :host {
    display: block;
    width: 100%;
  }

  .pay-options-container {
    max-height: 196px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
  }

  .pay-options-container::-webkit-scrollbar {
    display: none;
  }

  .pay-option-container {
    border-radius: ${({borderRadius:e})=>e[4]};
    padding: ${({spacing:e})=>e[3]};
    min-height: 60px;
  }

  .token-images-container {
    position: relative;
    justify-content: center;
    align-items: center;
  }

  .chain-image {
    position: absolute;
    bottom: -3px;
    right: -5px;
    border: 2px solid ${({tokens:e})=>e.theme.foregroundSecondary};
  }
`;var ir=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},st=class extends h{render(){return a`
      <wui-flex flexDirection="column" gap="2" class="pay-options-container">
        ${this.renderOptionEntry()} ${this.renderOptionEntry()} ${this.renderOptionEntry()}
      </wui-flex>
    `}renderOptionEntry(){return a`
      <wui-flex
        alignItems="center"
        justifyContent="space-between"
        gap="2"
        class="pay-option-container"
      >
        <wui-flex alignItems="center" gap="2">
          <wui-flex class="token-images-container">
            <wui-shimmer
              width="32px"
              height="32px"
              rounded
              variant="light"
              class="token-image"
            ></wui-shimmer>
            <wui-shimmer
              width="16px"
              height="16px"
              rounded
              variant="light"
              class="chain-image"
            ></wui-shimmer>
          </wui-flex>

          <wui-flex flexDirection="column" gap="1">
            <wui-shimmer
              width="74px"
              height="16px"
              borderRadius="4xs"
              variant="light"
            ></wui-shimmer>
            <wui-shimmer
              width="46px"
              height="14px"
              borderRadius="4xs"
              variant="light"
            ></wui-shimmer>
          </wui-flex>
        </wui-flex>
      </wui-flex>
    `}};st.styles=[fo];st=ir([m("w3m-pay-options-skeleton")],st);var wo=f`
  :host {
    display: block;
    width: 100%;
  }

  .pay-options-container {
    max-height: 196px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
    mask-image: var(--options-mask-image);
    -webkit-mask-image: var(--options-mask-image);
  }

  .pay-options-container::-webkit-scrollbar {
    display: none;
  }

  .pay-option-container {
    cursor: pointer;
    border-radius: ${({borderRadius:e})=>e[4]};
    padding: ${({spacing:e})=>e[3]};
    transition: background-color ${({durations:e})=>e.lg}
      ${({easings:e})=>e["ease-out-power-1"]};
    will-change: background-color;
  }

  .token-images-container {
    position: relative;
    justify-content: center;
    align-items: center;
  }

  .token-image {
    border-radius: ${({borderRadius:e})=>e.round};
    width: 32px;
    height: 32px;
  }

  .chain-image {
    position: absolute;
    width: 16px;
    height: 16px;
    bottom: -3px;
    right: -5px;
    border-radius: ${({borderRadius:e})=>e.round};
    border: 2px solid ${({tokens:e})=>e.theme.backgroundPrimary};
  }

  @media (hover: hover) and (pointer: fine) {
    .pay-option-container:hover {
      background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    }
  }
`;var We=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},nr=300,ye=class extends h{constructor(){super(),this.unsubscribe=[],this.options=[],this.selectedPaymentAsset=null}disconnectedCallback(){this.unsubscribe.forEach(o=>o()),this.resizeObserver?.disconnect(),this.shadowRoot?.querySelector(".pay-options-container")?.removeEventListener("scroll",this.handleOptionsListScroll.bind(this))}firstUpdated(){let t=this.shadowRoot?.querySelector(".pay-options-container");t&&(requestAnimationFrame(this.handleOptionsListScroll.bind(this)),t?.addEventListener("scroll",this.handleOptionsListScroll.bind(this)),this.resizeObserver=new ResizeObserver(()=>{this.handleOptionsListScroll()}),this.resizeObserver?.observe(t),this.handleOptionsListScroll())}render(){return a`
      <wui-flex flexDirection="column" gap="2" class="pay-options-container">
        ${this.options.map(t=>this.payOptionTemplate(t))}
      </wui-flex>
    `}payOptionTemplate(t){let{network:o,metadata:i,asset:n,amount:r="0"}=t,c=g.getAllRequestedCaipNetworks().find(Fo=>Fo.caipNetworkId===o),E=`${o}:${n}`,je=`${this.selectedPaymentAsset?.network}:${this.selectedPaymentAsset?.asset}`,Wo=E===je,ht=S.bigNumber(r,{safe:!0}),Bo=ht.gt(0);return a`
      <wui-flex
        alignItems="center"
        justifyContent="space-between"
        gap="2"
        @click=${()=>this.onSelect?.(t)}
        class="pay-option-container"
      >
        <wui-flex alignItems="center" gap="2">
          <wui-flex class="token-images-container">
            <wui-image
              src=${b(i.logoURI)}
              class="token-image"
              size="3xl"
            ></wui-image>
            <wui-image
              src=${b(A.getNetworkImage(c))}
              class="chain-image"
              size="md"
            ></wui-image>
          </wui-flex>

          <wui-flex flexDirection="column" gap="1">
            <wui-text variant="lg-regular" color="primary">${i.symbol}</wui-text>
            ${Bo?a`<wui-text variant="sm-regular" color="secondary">
                  ${ht.round(6).toString()} ${i.symbol}
                </wui-text>`:null}
          </wui-flex>
        </wui-flex>

        ${Wo?a`<wui-icon name="checkmark" size="md" color="success"></wui-icon>`:null}
      </wui-flex>
    `}handleOptionsListScroll(){let t=this.shadowRoot?.querySelector(".pay-options-container");if(!t)return;t.scrollHeight>nr?(t.style.setProperty("--options-mask-image",`linear-gradient(
          to bottom,
          rgba(0, 0, 0, calc(1 - var(--options-scroll--top-opacity))) 0px,
          rgba(200, 200, 200, calc(1 - var(--options-scroll--top-opacity))) 1px,
          black 50px,
          black calc(100% - 50px),
          rgba(155, 155, 155, calc(1 - var(--options-scroll--bottom-opacity))) calc(100% - 1px),
          rgba(0, 0, 0, calc(1 - var(--options-scroll--bottom-opacity))) 100%
        )`),t.style.setProperty("--options-scroll--top-opacity",He.interpolate([0,50],[0,1],t.scrollTop).toString()),t.style.setProperty("--options-scroll--bottom-opacity",He.interpolate([0,50],[0,1],t.scrollHeight-t.scrollTop-t.offsetHeight).toString())):(t.style.setProperty("--options-mask-image","none"),t.style.setProperty("--options-scroll--top-opacity","0"),t.style.setProperty("--options-scroll--bottom-opacity","0"))}};ye.styles=[wo];We([u({type:Array})],ye.prototype,"options",void 0);We([u()],ye.prototype,"selectedPaymentAsset",void 0);We([u()],ye.prototype,"onSelect",void 0);ye=We([m("w3m-pay-options")],ye);var go=f`
  .payment-methods-container {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    border-top-right-radius: ${({borderRadius:e})=>e[5]};
    border-top-left-radius: ${({borderRadius:e})=>e[5]};
  }

  .pay-options-container {
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    border-radius: ${({borderRadius:e})=>e[5]};
    padding: ${({spacing:e})=>e[1]};
  }

  w3m-tooltip-trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    max-width: fit-content;
  }

  wui-image {
    border-radius: ${({borderRadius:e})=>e.round};
  }

  w3m-pay-options.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
`;var _=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},Be={eip155:"ethereum",solana:"solana",bip122:"bitcoin",ton:"ton"},sr={eip155:{icon:Be.eip155,label:"EVM"},solana:{icon:Be.solana,label:"Solana"},bip122:{icon:Be.bip122,label:"Bitcoin"},ton:{icon:Be.ton,label:"Ton"}},N=class extends h{constructor(){super(),this.unsubscribe=[],this.profileName=null,this.paymentAsset=d.state.paymentAsset,this.namespace=void 0,this.caipAddress=void 0,this.amount=d.state.amount,this.recipient=d.state.recipient,this.activeConnectorIds=P.state.activeConnectorIds,this.selectedPaymentAsset=d.state.selectedPaymentAsset,this.selectedExchange=d.state.selectedExchange,this.isFetchingQuote=d.state.isFetchingQuote,this.quoteError=d.state.quoteError,this.quote=d.state.quote,this.isFetchingTokenBalances=d.state.isFetchingTokenBalances,this.tokenBalances=d.state.tokenBalances,this.isPaymentInProgress=d.state.isPaymentInProgress,this.exchangeUrlForQuote=d.state.exchangeUrlForQuote,this.completedTransactionsCount=0,this.unsubscribe.push(d.subscribeKey("paymentAsset",t=>this.paymentAsset=t)),this.unsubscribe.push(d.subscribeKey("tokenBalances",t=>this.onTokenBalancesChanged(t))),this.unsubscribe.push(d.subscribeKey("isFetchingTokenBalances",t=>this.isFetchingTokenBalances=t)),this.unsubscribe.push(P.subscribeKey("activeConnectorIds",t=>this.activeConnectorIds=t)),this.unsubscribe.push(d.subscribeKey("selectedPaymentAsset",t=>this.selectedPaymentAsset=t)),this.unsubscribe.push(d.subscribeKey("isFetchingQuote",t=>this.isFetchingQuote=t)),this.unsubscribe.push(d.subscribeKey("quoteError",t=>this.quoteError=t)),this.unsubscribe.push(d.subscribeKey("quote",t=>this.quote=t)),this.unsubscribe.push(d.subscribeKey("amount",t=>this.amount=t)),this.unsubscribe.push(d.subscribeKey("recipient",t=>this.recipient=t)),this.unsubscribe.push(d.subscribeKey("isPaymentInProgress",t=>this.isPaymentInProgress=t)),this.unsubscribe.push(d.subscribeKey("selectedExchange",t=>this.selectedExchange=t)),this.unsubscribe.push(d.subscribeKey("exchangeUrlForQuote",t=>this.exchangeUrlForQuote=t)),this.resetQuoteState(),this.initializeNamespace(),this.fetchTokens()}disconnectedCallback(){super.disconnectedCallback(),this.resetAssetsState(),this.unsubscribe.forEach(t=>t())}updated(t){super.updated(t),t.has("selectedPaymentAsset")&&this.fetchQuote()}render(){return a`
      <wui-flex flexDirection="column">
        ${this.profileTemplate()}

        <wui-flex
          flexDirection="column"
          gap="4"
          class="payment-methods-container"
          .padding=${["4","4","5","4"]}
        >
          ${this.paymentOptionsViewTemplate()} ${this.amountWithFeeTemplate()}

          <wui-flex
            alignItems="center"
            justifyContent="space-between"
            .padding=${["1","0","1","0"]}
          >
            <wui-separator></wui-separator>
          </wui-flex>

          ${this.paymentActionsTemplate()}
        </wui-flex>
      </wui-flex>
    `}profileTemplate(){if(this.selectedExchange){let s=S.formatNumber(this.quote?.origin.amount,{decimals:this.quote?.origin.currency.metadata.decimals??0}).toString();return a`
        <wui-flex
          .padding=${["4","3","4","3"]}
          alignItems="center"
          justifyContent="space-between"
          gap="2"
        >
          <wui-text variant="lg-regular" color="secondary">Paying with</wui-text>

          ${this.quote?a`<wui-text variant="lg-regular" color="primary">
                ${S.bigNumber(s,{safe:!0}).round(6).toString()}
                ${this.quote.origin.currency.metadata.symbol}
              </wui-text>`:a`<wui-shimmer width="80px" height="18px" variant="light"></wui-shimmer>`}
        </wui-flex>
      `}let t=L.getPlainAddress(this.caipAddress)??"",{name:o,image:i}=this.getWalletProperties({namespace:this.namespace}),{icon:n,label:r}=sr[this.namespace]??{};return a`
      <wui-flex
        .padding=${["4","3","4","3"]}
        alignItems="center"
        justifyContent="space-between"
        gap="2"
      >
        <wui-wallet-switch
          profileName=${b(this.profileName)}
          address=${b(t)}
          imageSrc=${b(i)}
          alt=${b(o)}
          @click=${this.onConnectOtherWallet.bind(this)}
          data-testid="wui-wallet-switch"
        ></wui-wallet-switch>

        <wui-wallet-switch
          profileName=${b(r)}
          address=${b(t)}
          icon=${b(n)}
          iconSize="xs"
          .enableGreenCircle=${!1}
          alt=${b(r)}
          @click=${this.onConnectOtherWallet.bind(this)}
          data-testid="wui-wallet-switch"
        ></wui-wallet-switch>
      </wui-flex>
    `}initializeNamespace(){let t=g.state.activeChain;this.namespace=t,this.caipAddress=g.getAccountData(t)?.caipAddress,this.profileName=g.getAccountData(t)?.profileName??null,this.unsubscribe.push(g.subscribeChainProp("accountState",o=>this.onAccountStateChanged(o),t))}async fetchTokens(){if(this.namespace){let t;if(this.caipAddress){let{chainId:o,chainNamespace:i}=C.parseCaipAddress(this.caipAddress),n=`${i}:${o}`;t=g.getAllRequestedCaipNetworks().find(s=>s.caipNetworkId===n)}await d.fetchTokens({caipAddress:this.caipAddress,caipNetwork:t,namespace:this.namespace})}}fetchQuote(){if(this.amount&&this.recipient&&this.selectedPaymentAsset&&this.paymentAsset){let{address:t}=this.caipAddress?C.parseCaipAddress(this.caipAddress):{};d.fetchQuote({amount:this.amount.toString(),address:t,sourceToken:this.selectedPaymentAsset,toToken:this.paymentAsset,recipient:this.recipient})}}getWalletProperties({namespace:t}){if(!t)return{name:void 0,image:void 0};let o=this.activeConnectorIds[t];if(!o)return{name:void 0,image:void 0};let i=P.getConnector({id:o,namespace:t});if(!i)return{name:void 0,image:void 0};let n=A.getConnectorImage(i);return{name:i.name,image:n}}paymentOptionsViewTemplate(){return a`
      <wui-flex flexDirection="column" gap="2">
        <wui-text variant="sm-regular" color="secondary">CHOOSE PAYMENT OPTION</wui-text>
        <wui-flex class="pay-options-container">${this.paymentOptionsTemplate()}</wui-flex>
      </wui-flex>
    `}paymentOptionsTemplate(){let t=this.getPaymentAssetFromTokenBalances();if(this.isFetchingTokenBalances)return a`<w3m-pay-options-skeleton></w3m-pay-options-skeleton>`;if(t.length===0)return a`<w3m-pay-options-empty
        @connectOtherWallet=${this.onConnectOtherWallet.bind(this)}
      ></w3m-pay-options-empty>`;let o={disabled:this.isFetchingQuote};return a`<w3m-pay-options
      class=${$e(o)}
      .options=${t}
      .selectedPaymentAsset=${b(this.selectedPaymentAsset)}
      .onSelect=${this.onSelectedPaymentAssetChanged.bind(this)}
    ></w3m-pay-options>`}amountWithFeeTemplate(){return this.isFetchingQuote||!this.selectedPaymentAsset||this.quoteError?a`<w3m-pay-fees-skeleton></w3m-pay-fees-skeleton>`:a`<w3m-pay-fees></w3m-pay-fees>`}paymentActionsTemplate(){let t=this.isFetchingQuote||this.isFetchingTokenBalances,o=this.isFetchingQuote||this.isFetchingTokenBalances||!this.selectedPaymentAsset||!!this.quoteError,i=S.formatNumber(this.quote?.origin.amount??0,{decimals:this.quote?.origin.currency.metadata.decimals??0}).toString();return this.selectedExchange?t||o?a`
          <wui-shimmer width="100%" height="48px" variant="light" ?rounded=${!0}></wui-shimmer>
        `:a`<wui-button
        size="lg"
        fullWidth
        variant="accent-secondary"
        @click=${this.onPayWithExchange.bind(this)}
      >
        ${`Continue in ${this.selectedExchange.name}`}

        <wui-icon name="arrowRight" color="inherit" size="sm" slot="iconRight"></wui-icon>
      </wui-button>`:a`
      <wui-flex alignItems="center" justifyContent="space-between">
        <wui-flex flexDirection="column" gap="1">
          <wui-text variant="md-regular" color="secondary">Order Total</wui-text>

          ${t||o?a`<wui-shimmer width="58px" height="32px" variant="light"></wui-shimmer>`:a`<wui-flex alignItems="center" gap="01">
                <wui-text variant="h4-regular" color="primary">${pe(i)}</wui-text>

                <wui-text variant="lg-regular" color="secondary">
                  ${this.quote?.origin.currency.metadata.symbol||"Unknown"}
                </wui-text>
              </wui-flex>`}
        </wui-flex>

        ${this.actionButtonTemplate({isLoading:t,isDisabled:o})}
      </wui-flex>
    `}actionButtonTemplate(t){let o=Oe(this.quote),{isLoading:i,isDisabled:n}=t,r="Pay";return o.length>1&&this.completedTransactionsCount===0&&(r="Approve"),a`
      <wui-button
        size="lg"
        variant="accent-primary"
        ?loading=${i||this.isPaymentInProgress}
        ?disabled=${n||this.isPaymentInProgress}
        @click=${()=>{o.length>0?this.onSendTransactions():this.onTransfer()}}
      >
        ${r}
        ${i?null:a`<wui-icon
              name="arrowRight"
              color="inherit"
              size="sm"
              slot="iconRight"
            ></wui-icon>`}
      </wui-button>
    `}getPaymentAssetFromTokenBalances(){return this.namespace?(this.tokenBalances[this.namespace]??[]).map(n=>{try{return to(n)}catch{return null}}).filter(n=>!!n).filter(n=>{let{chainId:r}=C.parseCaipNetworkId(n.network),{chainId:s}=C.parseCaipNetworkId(this.paymentAsset.network);return R.isLowerCaseMatch(n.asset,this.paymentAsset.asset)?!0:this.selectedExchange?!R.isLowerCaseMatch(r.toString(),s.toString()):!0}):[]}onTokenBalancesChanged(t){this.tokenBalances=t;let[o]=this.getPaymentAssetFromTokenBalances();o&&d.setSelectedPaymentAsset(o)}async onConnectOtherWallet(){await P.connect(),await $.open({view:"PayQuote"})}onAccountStateChanged(t){let{address:o}=this.caipAddress?C.parseCaipAddress(this.caipAddress):{};if(this.caipAddress=t?.caipAddress,this.profileName=t?.profileName??null,o){let{address:i}=this.caipAddress?C.parseCaipAddress(this.caipAddress):{};i?R.isLowerCaseMatch(i,o)||(this.resetAssetsState(),this.resetQuoteState(),this.fetchTokens()):$.close()}}onSelectedPaymentAssetChanged(t){this.isFetchingQuote||d.setSelectedPaymentAsset(t)}async onTransfer(){let t=Ee(this.quote);if(t){if(!R.isLowerCaseMatch(this.selectedPaymentAsset?.asset,t.deposit.currency))throw new Error("Quote asset is not the same as the selected payment asset");let i=this.selectedPaymentAsset?.amount??"0",n=S.formatNumber(t.deposit.amount,{decimals:this.selectedPaymentAsset?.metadata.decimals??0}).toString();if(!S.bigNumber(i).gte(n)){k.showError("Insufficient funds");return}if(this.quote&&this.selectedPaymentAsset&&this.caipAddress&&this.namespace){let{address:s}=C.parseCaipAddress(this.caipAddress);await d.onTransfer({chainNamespace:this.namespace,fromAddress:s,toAddress:t.deposit.receiver,amount:n,paymentAsset:this.selectedPaymentAsset}),d.setRequestId(t.requestId),w.push("PayLoading")}}}async onSendTransactions(){let t=this.selectedPaymentAsset?.amount??"0",o=S.formatNumber(this.quote?.origin.amount??0,{decimals:this.selectedPaymentAsset?.metadata.decimals??0}).toString();if(!S.bigNumber(t).gte(o)){k.showError("Insufficient funds");return}let n=Oe(this.quote),[r]=Oe(this.quote,this.completedTransactionsCount);r&&this.namespace&&(await d.onSendTransaction({namespace:this.namespace,transactionStep:r}),this.completedTransactionsCount+=1,this.completedTransactionsCount===n.length&&(d.setRequestId(r.requestId),w.push("PayLoading")))}onPayWithExchange(){if(this.exchangeUrlForQuote){let t=L.returnOpenHref("","popupWindow","scrollbar=yes,width=480,height=720");if(!t)throw new Error("Could not create popup window");t.location.href=this.exchangeUrlForQuote;let o=Ee(this.quote);o&&d.setRequestId(o.requestId),d.initiatePayment(),w.push("PayLoading")}}resetAssetsState(){d.setSelectedPaymentAsset(null)}resetQuoteState(){d.resetQuoteState()}};N.styles=go;_([p()],N.prototype,"profileName",void 0);_([p()],N.prototype,"paymentAsset",void 0);_([p()],N.prototype,"namespace",void 0);_([p()],N.prototype,"caipAddress",void 0);_([p()],N.prototype,"amount",void 0);_([p()],N.prototype,"recipient",void 0);_([p()],N.prototype,"activeConnectorIds",void 0);_([p()],N.prototype,"selectedPaymentAsset",void 0);_([p()],N.prototype,"selectedExchange",void 0);_([p()],N.prototype,"isFetchingQuote",void 0);_([p()],N.prototype,"quoteError",void 0);_([p()],N.prototype,"quote",void 0);_([p()],N.prototype,"isFetchingTokenBalances",void 0);_([p()],N.prototype,"tokenBalances",void 0);_([p()],N.prototype,"isPaymentInProgress",void 0);_([p()],N.prototype,"exchangeUrlForQuote",void 0);_([p()],N.prototype,"completedTransactionsCount",void 0);N=_([m("w3m-pay-quote-view")],N);var yo=f`
  wui-image {
    border-radius: ${({borderRadius:e})=>e.round};
  }

  .transfers-badge {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    border: 1px solid ${({tokens:e})=>e.theme.foregroundSecondary};
    border-radius: ${({borderRadius:e})=>e[4]};
  }
`;var at=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},Ce=class extends h{constructor(){super(),this.unsubscribe=[],this.paymentAsset=d.state.paymentAsset,this.amount=d.state.amount,this.unsubscribe.push(d.subscribeKey("paymentAsset",t=>{this.paymentAsset=t}),d.subscribeKey("amount",t=>{this.amount=t}))}disconnectedCallback(){this.unsubscribe.forEach(t=>t())}render(){let o=g.getAllRequestedCaipNetworks().find(i=>i.caipNetworkId===this.paymentAsset.network);return a`<wui-flex
      alignItems="center"
      gap="1"
      .padding=${["1","2","1","1"]}
      class="transfers-badge"
    >
      <wui-image src=${b(this.paymentAsset.metadata.logoURI)} size="xl"></wui-image>
      <wui-text variant="lg-regular" color="primary">
        ${this.amount} ${this.paymentAsset.metadata.symbol}
      </wui-text>
      <wui-text variant="sm-regular" color="secondary">
        on ${o?.name??"Unknown"}
      </wui-text>
    </wui-flex>`}};Ce.styles=[yo];at([u()],Ce.prototype,"paymentAsset",void 0);at([u()],Ce.prototype,"amount",void 0);Ce=at([m("w3m-pay-header")],Ce);var bo=f`
  :host {
    height: 60px;
  }

  :host > wui-flex {
    box-sizing: border-box;
    background-color: var(--local-header-background-color);
  }

  wui-text {
    background-color: var(--local-header-background-color);
  }

  wui-flex.w3m-header-title {
    transform: translateY(0);
    opacity: 1;
  }

  wui-flex.w3m-header-title[view-direction='prev'] {
    animation:
      slide-down-out 120ms forwards ${({easings:e})=>e["ease-out-power-2"]},
      slide-down-in 120ms forwards ${({easings:e})=>e["ease-out-power-2"]};
    animation-delay: 0ms, 200ms;
  }

  wui-flex.w3m-header-title[view-direction='next'] {
    animation:
      slide-up-out 120ms forwards ${({easings:e})=>e["ease-out-power-2"]},
      slide-up-in 120ms forwards ${({easings:e})=>e["ease-out-power-2"]};
    animation-delay: 0ms, 200ms;
  }

  wui-icon-button[data-hidden='true'] {
    opacity: 0 !important;
    pointer-events: none;
  }

  @keyframes slide-up-out {
    from {
      transform: translateY(0px);
      opacity: 1;
    }
    to {
      transform: translateY(3px);
      opacity: 0;
    }
  }

  @keyframes slide-up-in {
    from {
      transform: translateY(-3px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  @keyframes slide-down-out {
    from {
      transform: translateY(0px);
      opacity: 1;
    }
    to {
      transform: translateY(-3px);
      opacity: 0;
    }
  }

  @keyframes slide-down-in {
    from {
      transform: translateY(3px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
`;var le=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},ar=["SmartSessionList"],cr={PayWithExchange:te.tokens.theme.foregroundPrimary};function xo(){let e=w.state.data?.connector?.name,t=w.state.data?.wallet?.name,o=w.state.data?.network?.name,i=t??e,n=P.getConnectors(),r=n.length===1&&n[0]?.id==="w3m-email",s=g.getAccountData()?.socialProvider,c=s?s.charAt(0).toUpperCase()+s.slice(1):"Connect Social";return{Connect:`Connect ${r?"Email":""} Wallet`,Create:"Create Wallet",ChooseAccountName:void 0,Account:void 0,AccountSettings:void 0,AllWallets:"All Wallets",ApproveTransaction:"Approve Transaction",BuyInProgress:"Buy",UsageExceeded:"Usage Exceeded",ConnectingExternal:i??"Connect Wallet",ConnectingWalletConnect:i??"WalletConnect",ConnectingWalletConnectBasic:"WalletConnect",ConnectingSiwe:"Sign In",Convert:"Convert",ConvertSelectToken:"Select token",ConvertPreview:"Preview Convert",Downloads:i?`Get ${i}`:"Downloads",EmailLogin:"Email Login",EmailVerifyOtp:"Confirm Email",EmailVerifyDevice:"Register Device",GetWallet:"Get a Wallet",Networks:"Choose Network",OnRampProviders:"Choose Provider",OnRampActivity:"Activity",OnRampTokenSelect:"Select Token",OnRampFiatSelect:"Select Currency",Pay:"How you pay",ProfileWallets:"Wallets",SwitchNetwork:o??"Switch Network",Transactions:"Activity",UnsupportedChain:"Switch Network",UpgradeEmailWallet:"Upgrade Your Wallet",UpdateEmailWallet:"Edit Email",UpdateEmailPrimaryOtp:"Confirm Current Email",UpdateEmailSecondaryOtp:"Confirm New Email",WhatIsABuy:"What is Buy?",RegisterAccountName:"Choose Name",RegisterAccountNameSuccess:"",WalletReceive:"Receive",WalletCompatibleNetworks:"Compatible Networks",Swap:"Swap",SwapSelectToken:"Select Token",SwapPreview:"Preview Swap",WalletSend:"Send",WalletSendPreview:"Review Send",WalletSendSelectToken:"Select Token",WalletSendConfirmed:"Confirmed",WhatIsANetwork:"What is a network?",WhatIsAWallet:"What is a Wallet?",ConnectWallets:"Connect Wallet",ConnectSocials:"All Socials",ConnectingSocial:c,ConnectingMultiChain:"Select Chain",ConnectingFarcaster:"Farcaster",SwitchActiveChain:"Switch Chain",SmartSessionCreated:void 0,SmartSessionList:"Smart Sessions",SIWXSignMessage:"Sign In",PayLoading:"Processing payment...",PayQuote:"Payment Quote",DataCapture:"Profile",DataCaptureOtpConfirm:"Confirm Email",FundWallet:"Fund Wallet",PayWithExchange:"Deposit from Exchange",PayWithExchangeSelectAsset:"Select Asset",SmartAccountSettings:"Smart Account Settings"}}var Y=class extends h{constructor(){super(),this.unsubscribe=[],this.heading=xo()[w.state.view],this.network=g.state.activeCaipNetwork,this.networkImage=A.getNetworkImage(this.network),this.showBack=!1,this.prevHistoryLength=1,this.view=w.state.view,this.viewDirection="",this.unsubscribe.push(vt.subscribeNetworkImages(()=>{this.networkImage=A.getNetworkImage(this.network)}),w.subscribeKey("view",t=>{setTimeout(()=>{this.view=t,this.heading=xo()[t]},X.ANIMATION_DURATIONS.HeaderText),this.onViewChange(),this.onHistoryChange()}),g.subscribeKey("activeCaipNetwork",t=>{this.network=t,this.networkImage=A.getNetworkImage(this.network)}))}disconnectCallback(){this.unsubscribe.forEach(t=>t())}render(){let t=cr[w.state.view]??te.tokens.theme.backgroundPrimary;return this.style.setProperty("--local-header-background-color",t),a`
      <wui-flex
        .padding=${["0","4","0","4"]}
        justifyContent="space-between"
        alignItems="center"
      >
        ${this.leftHeaderTemplate()} ${this.titleTemplate()} ${this.rightHeaderTemplate()}
      </wui-flex>
    `}onWalletHelp(){D.sendEvent({type:"track",event:"CLICK_WALLET_HELP"}),w.push("WhatIsAWallet")}async onClose(){await Pe.safeClose()}rightHeaderTemplate(){let t=v?.state?.features?.smartSessions;return w.state.view!=="Account"||!t?this.closeButtonTemplate():a`<wui-flex>
      <wui-icon-button
        icon="clock"
        size="lg"
        iconSize="lg"
        type="neutral"
        variant="primary"
        @click=${()=>w.push("SmartSessionList")}
        data-testid="w3m-header-smart-sessions"
      ></wui-icon-button>
      ${this.closeButtonTemplate()}
    </wui-flex> `}closeButtonTemplate(){return a`
      <wui-icon-button
        icon="close"
        size="lg"
        type="neutral"
        variant="primary"
        iconSize="lg"
        @click=${this.onClose.bind(this)}
        data-testid="w3m-header-close"
      ></wui-icon-button>
    `}titleTemplate(){if(this.view==="PayQuote")return a`<w3m-pay-header></w3m-pay-header>`;let t=ar.includes(this.view);return a`
      <wui-flex
        view-direction="${this.viewDirection}"
        class="w3m-header-title"
        alignItems="center"
        gap="2"
      >
        <wui-text
          display="inline"
          variant="lg-regular"
          color="primary"
          data-testid="w3m-header-text"
        >
          ${this.heading}
        </wui-text>
        ${t?a`<wui-tag variant="accent" size="md">Beta</wui-tag>`:null}
      </wui-flex>
    `}leftHeaderTemplate(){let{view:t}=w.state,o=t==="Connect",i=v.state.enableEmbedded,n=t==="ApproveTransaction",r=t==="ConnectingSiwe",s=t==="Account",c=v.state.enableNetworkSwitch,E=n||r||o&&i;return s&&c?a`<wui-select
        id="dynamic"
        data-testid="w3m-account-select-network"
        active-network=${b(this.network?.name)}
        @click=${this.onNetworks.bind(this)}
        imageSrc=${b(this.networkImage)}
      ></wui-select>`:this.showBack&&!E?a`<wui-icon-button
        data-testid="header-back"
        id="dynamic"
        icon="chevronLeft"
        size="lg"
        iconSize="lg"
        type="neutral"
        variant="primary"
        @click=${this.onGoBack.bind(this)}
      ></wui-icon-button>`:a`<wui-icon-button
      data-hidden=${!o}
      id="dynamic"
      icon="helpCircle"
      size="lg"
      iconSize="lg"
      type="neutral"
      variant="primary"
      @click=${this.onWalletHelp.bind(this)}
    ></wui-icon-button>`}onNetworks(){this.isAllowedNetworkSwitch()&&(D.sendEvent({type:"track",event:"CLICK_NETWORKS"}),w.push("Networks"))}isAllowedNetworkSwitch(){let t=g.getAllRequestedCaipNetworks(),o=t?t.length>1:!1,i=t?.find(({id:n})=>n===this.network?.id);return o||!i}onViewChange(){let{history:t}=w.state,o=X.VIEW_DIRECTION.Next;t.length<this.prevHistoryLength&&(o=X.VIEW_DIRECTION.Prev),this.prevHistoryLength=t.length,this.viewDirection=o}async onHistoryChange(){let{history:t}=w.state,o=this.shadowRoot?.querySelector("#dynamic");t.length>1&&!this.showBack&&o?(await o.animate([{opacity:1},{opacity:0}],{duration:200,fill:"forwards",easing:"ease"}).finished,this.showBack=!0,o.animate([{opacity:0},{opacity:1}],{duration:200,fill:"forwards",easing:"ease"})):t.length<=1&&this.showBack&&o&&(await o.animate([{opacity:1},{opacity:0}],{duration:200,fill:"forwards",easing:"ease"}).finished,this.showBack=!1,o.animate([{opacity:0},{opacity:1}],{duration:200,fill:"forwards",easing:"ease"}))}onGoBack(){w.goBack()}};Y.styles=bo;le([p()],Y.prototype,"heading",void 0);le([p()],Y.prototype,"network",void 0);le([p()],Y.prototype,"networkImage",void 0);le([p()],Y.prototype,"showBack",void 0);le([p()],Y.prototype,"prevHistoryLength",void 0);le([p()],Y.prototype,"view",void 0);le([p()],Y.prototype,"viewDirection",void 0);Y=le([m("w3m-header")],Y);var vo=f`
  :host {
    display: flex;
    align-items: center;
    gap: ${({spacing:e})=>e[1]};
    padding: ${({spacing:e})=>e[2]} ${({spacing:e})=>e[3]}
      ${({spacing:e})=>e[2]} ${({spacing:e})=>e[2]};
    border-radius: ${({borderRadius:e})=>e[20]};
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    box-shadow:
      0px 0px 8px 0px rgba(0, 0, 0, 0.1),
      inset 0 0 0 1px ${({tokens:e})=>e.theme.borderPrimary};
    max-width: 320px;
  }

  wui-icon-box {
    border-radius: ${({borderRadius:e})=>e.round} !important;
    overflow: hidden;
  }

  wui-loading-spinner {
    padding: ${({spacing:e})=>e[1]};
    background-color: ${({tokens:e})=>e.core.foregroundAccent010};
    border-radius: ${({borderRadius:e})=>e.round} !important;
  }
`;var ct=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},Se=class extends h{constructor(){super(...arguments),this.message="",this.variant="success"}render(){return a`
      ${this.templateIcon()}
      <wui-text variant="lg-regular" color="primary" data-testid="wui-snackbar-message"
        >${this.message}</wui-text
      >
    `}templateIcon(){let t={success:"success",error:"error",warning:"warning",info:"default"},o={success:"checkmark",error:"warning",warning:"warningCircle",info:"info"};return this.variant==="loading"?a`<wui-loading-spinner size="md" color="accent-primary"></wui-loading-spinner>`:a`<wui-icon-box
      size="md"
      color=${t[this.variant]}
      icon=${o[this.variant]}
    ></wui-icon-box>`}};Se.styles=[I,vo];ct([u()],Se.prototype,"message",void 0);ct([u()],Se.prototype,"variant",void 0);Se=ct([m("wui-snackbar")],Se);var Eo=ee`
  :host {
    display: block;
    position: absolute;
    opacity: 0;
    pointer-events: none;
    top: 11px;
    left: 50%;
    width: max-content;
  }
`;var Co=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},Fe=class extends h{constructor(){super(),this.unsubscribe=[],this.timeout=void 0,this.open=k.state.open,this.unsubscribe.push(k.subscribeKey("open",t=>{this.open=t,this.onOpen()}))}disconnectedCallback(){clearTimeout(this.timeout),this.unsubscribe.forEach(t=>t())}render(){let{message:t,variant:o}=k.state;return a` <wui-snackbar message=${t} variant=${o}></wui-snackbar> `}onOpen(){clearTimeout(this.timeout),this.open?(this.animate([{opacity:0,transform:"translateX(-50%) scale(0.85)"},{opacity:1,transform:"translateX(-50%) scale(1)"}],{duration:150,fill:"forwards",easing:"ease"}),this.timeout&&clearTimeout(this.timeout),k.state.autoClose&&(this.timeout=setTimeout(()=>k.hide(),2500))):this.animate([{opacity:1,transform:"translateX(-50%) scale(1)"},{opacity:0,transform:"translateX(-50%) scale(0.85)"}],{duration:150,fill:"forwards",easing:"ease"})}};Fe.styles=Eo;Co([p()],Fe.prototype,"open",void 0);Fe=Co([m("w3m-snackbar")],Fe);var So=ee`
  :host {
    width: 100%;
    display: block;
  }
`;var lt=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},ke=class extends h{constructor(){super(),this.unsubscribe=[],this.text="",this.open=W.state.open,this.unsubscribe.push(w.subscribeKey("view",()=>{W.hide()}),$.subscribeKey("open",t=>{t||W.hide()}),W.subscribeKey("open",t=>{this.open=t}))}disconnectedCallback(){this.unsubscribe.forEach(t=>t()),W.hide()}render(){return a`
      <div
        @pointermove=${this.onMouseEnter.bind(this)}
        @pointerleave=${this.onMouseLeave.bind(this)}
      >
        ${this.renderChildren()}
      </div>
    `}renderChildren(){return a`<slot></slot> `}onMouseEnter(){let t=this.getBoundingClientRect();if(!this.open){let o=document.querySelector("w3m-modal"),i={width:t.width,height:t.height,left:t.left,top:t.top};if(o){let n=o.getBoundingClientRect();i.left=t.left-(window.innerWidth-n.width)/2,i.top=t.top-(window.innerHeight-n.height)/2}W.showTooltip({message:this.text,triggerRect:i,variant:"shade"})}}onMouseLeave(t){this.contains(t.relatedTarget)||W.hide()}};ke.styles=[So];lt([u()],ke.prototype,"text",void 0);lt([p()],ke.prototype,"open",void 0);ke=lt([m("w3m-tooltip-trigger")],ke);var ko=f`
  :host {
    pointer-events: none;
  }

  :host > wui-flex {
    display: var(--w3m-tooltip-display);
    opacity: var(--w3m-tooltip-opacity);
    padding: 9px ${({spacing:e})=>e[3]} 10px ${({spacing:e})=>e[3]};
    border-radius: ${({borderRadius:e})=>e[3]};
    color: ${({tokens:e})=>e.theme.backgroundPrimary};
    position: absolute;
    top: var(--w3m-tooltip-top);
    left: var(--w3m-tooltip-left);
    transform: translate(calc(-50% + var(--w3m-tooltip-parent-width)), calc(-100% - 8px));
    max-width: calc(var(--apkt-modal-width) - ${({spacing:e})=>e[5]});
    transition: opacity ${({durations:e})=>e.lg}
      ${({easings:e})=>e["ease-out-power-2"]};
    will-change: opacity;
    opacity: 0;
    animation-duration: ${({durations:e})=>e.xl};
    animation-timing-function: ${({easings:e})=>e["ease-out-power-2"]};
    animation-name: fade-in;
    animation-fill-mode: forwards;
  }

  :host([data-variant='shade']) > wui-flex {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
  }

  :host([data-variant='shade']) > wui-flex > wui-text {
    color: ${({tokens:e})=>e.theme.textSecondary};
  }

  :host([data-variant='fill']) > wui-flex {
    background-color: ${({tokens:e})=>e.theme.backgroundPrimary};
    border: 1px solid ${({tokens:e})=>e.theme.borderPrimary};
  }

  wui-icon {
    position: absolute;
    width: 12px !important;
    height: 4px !important;
    color: ${({tokens:e})=>e.theme.foregroundPrimary};
  }

  wui-icon[data-placement='top'] {
    bottom: 0px;
    left: 50%;
    transform: translate(-50%, 95%);
  }

  wui-icon[data-placement='bottom'] {
    top: 0;
    left: 50%;
    transform: translate(-50%, -95%) rotate(180deg);
  }

  wui-icon[data-placement='right'] {
    top: 50%;
    left: 0;
    transform: translate(-65%, -50%) rotate(90deg);
  }

  wui-icon[data-placement='left'] {
    top: 50%;
    right: 0%;
    transform: translate(65%, -50%) rotate(270deg);
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
`;var Ae=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},de=class extends h{constructor(){super(),this.unsubscribe=[],this.open=W.state.open,this.message=W.state.message,this.triggerRect=W.state.triggerRect,this.variant=W.state.variant,this.unsubscribe.push(W.subscribe(t=>{this.open=t.open,this.message=t.message,this.triggerRect=t.triggerRect,this.variant=t.variant}))}disconnectedCallback(){this.unsubscribe.forEach(t=>t())}render(){this.dataset.variant=this.variant;let t=this.triggerRect.top,o=this.triggerRect.left;return this.style.cssText=`
    --w3m-tooltip-top: ${t}px;
    --w3m-tooltip-left: ${o}px;
    --w3m-tooltip-parent-width: ${this.triggerRect.width/2}px;
    --w3m-tooltip-display: ${this.open?"flex":"none"};
    --w3m-tooltip-opacity: ${this.open?1:0};
    `,a`<wui-flex>
      <wui-icon data-placement="top" size="inherit" name="cursor"></wui-icon>
      <wui-text color="primary" variant="sm-regular">${this.message}</wui-text>
    </wui-flex>`}};de.styles=[ko];Ae([p()],de.prototype,"open",void 0);Ae([p()],de.prototype,"message",void 0);Ae([p()],de.prototype,"triggerRect",void 0);Ae([p()],de.prototype,"variant",void 0);de=Ae([m("w3m-tooltip")],de);var me={getTabsByNamespace(e){return!!e&&e===U.CHAIN.EVM?v.state.remoteFeatures?.activity===!1?X.ACCOUNT_TABS.filter(o=>o.label!=="Activity"):X.ACCOUNT_TABS:[]},isValidReownName(e){return/^[a-zA-Z0-9]+$/gu.test(e)},isValidEmail(e){return/^[^\s@]+@[^\s@]+\.[^\s@]+$/gu.test(e)},validateReownName(e){return e.replace(/\^/gu,"").toLowerCase().replace(/[^a-zA-Z0-9]/gu,"")},hasFooter(){let e=w.state.view;if(X.VIEWS_WITH_LEGAL_FOOTER.includes(e)){let{termsConditionsUrl:t,privacyPolicyUrl:o}=v.state,i=v.state.features?.legalCheckbox;return!(!t&&!o||i)}return X.VIEWS_WITH_DEFAULT_FOOTER.includes(e)}};var Ao=f`
  :host wui-ux-by-reown {
    padding-top: 0;
  }

  :host wui-ux-by-reown.branding-only {
    padding-top: ${({spacing:e})=>e[3]};
  }

  a {
    text-decoration: none;
    color: ${({tokens:e})=>e.core.textAccentPrimary};
    font-weight: 500;
  }
`;var Io=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},ze=class extends h{constructor(){super(),this.unsubscribe=[],this.remoteFeatures=v.state.remoteFeatures,this.unsubscribe.push(v.subscribeKey("remoteFeatures",t=>this.remoteFeatures=t))}disconnectedCallback(){this.unsubscribe.forEach(t=>t())}render(){let{termsConditionsUrl:t,privacyPolicyUrl:o}=v.state,i=v.state.features?.legalCheckbox;return!t&&!o||i?a`
        <wui-flex flexDirection="column"> ${this.reownBrandingTemplate(!0)} </wui-flex>
      `:a`
      <wui-flex flexDirection="column">
        <wui-flex .padding=${["4","3","3","3"]} justifyContent="center">
          <wui-text color="secondary" variant="md-regular" align="center">
            By connecting your wallet, you agree to our <br />
            ${this.termsTemplate()} ${this.andTemplate()} ${this.privacyTemplate()}
          </wui-text>
        </wui-flex>
        ${this.reownBrandingTemplate()}
      </wui-flex>
    `}andTemplate(){let{termsConditionsUrl:t,privacyPolicyUrl:o}=v.state;return t&&o?"and":""}termsTemplate(){let{termsConditionsUrl:t}=v.state;return t?a`<a href=${t} target="_blank" rel="noopener noreferrer"
      >Terms of Service</a
    >`:null}privacyTemplate(){let{privacyPolicyUrl:t}=v.state;return t?a`<a href=${t} target="_blank" rel="noopener noreferrer"
      >Privacy Policy</a
    >`:null}reownBrandingTemplate(t=!1){return this.remoteFeatures?.reownBranding?t?a`<wui-ux-by-reown class="branding-only"></wui-ux-by-reown>`:a`<wui-ux-by-reown></wui-ux-by-reown>`:null}};ze.styles=[Ao];Io([p()],ze.prototype,"remoteFeatures",void 0);ze=Io([m("w3m-legal-footer")],ze);var No=ee``;var lr=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},ut=class extends h{render(){let{termsConditionsUrl:t,privacyPolicyUrl:o}=v.state;return!t&&!o?null:a`
      <wui-flex
        .padding=${["4","3","3","3"]}
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        gap="3"
      >
        <wui-text color="secondary" variant="md-regular" align="center">
          We work with the best providers to give you the lowest fees and best support. More options
          coming soon!
        </wui-text>

        ${this.howDoesItWorkTemplate()}
      </wui-flex>
    `}howDoesItWorkTemplate(){return a` <wui-link @click=${this.onWhatIsBuy.bind(this)}>
      <wui-icon size="xs" color="accent-primary" slot="iconLeft" name="helpCircle"></wui-icon>
      How does it work?
    </wui-link>`}onWhatIsBuy(){D.sendEvent({type:"track",event:"SELECT_WHAT_IS_A_BUY",properties:{isSmartAccount:Ct(g.state.activeChain)===bt.ACCOUNT_TYPES.SMART_ACCOUNT}}),w.push("WhatIsABuy")}};ut.styles=[No];ut=lr([m("w3m-onramp-providers-footer")],ut);var Po=f`
  :host {
    display: block;
  }

  div.container {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    overflow: hidden;
    height: auto;
    display: block;
  }

  div.container[status='hide'] {
    animation: fade-out;
    animation-duration: var(--apkt-duration-dynamic);
    animation-timing-function: ${({easings:e})=>e["ease-out-power-2"]};
    animation-fill-mode: both;
    animation-delay: 0s;
  }

  div.container[status='show'] {
    animation: fade-in;
    animation-duration: var(--apkt-duration-dynamic);
    animation-timing-function: ${({easings:e})=>e["ease-out-power-2"]};
    animation-fill-mode: both;
    animation-delay: var(--apkt-duration-dynamic);
  }

  @keyframes fade-in {
    from {
      opacity: 0;
      filter: blur(6px);
    }
    to {
      opacity: 1;
      filter: blur(0px);
    }
  }

  @keyframes fade-out {
    from {
      opacity: 1;
      filter: blur(0px);
    }
    to {
      opacity: 0;
      filter: blur(6px);
    }
  }
`;var pt=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},Ie=class extends h{constructor(){super(...arguments),this.resizeObserver=void 0,this.unsubscribe=[],this.status="hide",this.view=w.state.view}firstUpdated(){this.status=me.hasFooter()?"show":"hide",this.unsubscribe.push(w.subscribeKey("view",t=>{this.view=t,this.status=me.hasFooter()?"show":"hide",this.status==="hide"&&document.documentElement.style.setProperty("--apkt-footer-height","0px")})),this.resizeObserver=new ResizeObserver(t=>{for(let o of t)if(o.target===this.getWrapper()){let i=`${o.contentRect.height}px`;document.documentElement.style.setProperty("--apkt-footer-height",i)}}),this.resizeObserver.observe(this.getWrapper())}render(){return a`
      <div class="container" status=${this.status}>${this.templatePageContainer()}</div>
    `}templatePageContainer(){return me.hasFooter()?a` ${this.templateFooter()}`:null}templateFooter(){switch(this.view){case"Networks":return this.templateNetworksFooter();case"Connect":case"ConnectWallets":case"OnRampFiatSelect":case"OnRampTokenSelect":return a`<w3m-legal-footer></w3m-legal-footer>`;case"OnRampProviders":return a`<w3m-onramp-providers-footer></w3m-onramp-providers-footer>`;default:return null}}templateNetworksFooter(){return a` <wui-flex
      class="footer-in"
      padding="3"
      flexDirection="column"
      gap="3"
      alignItems="center"
    >
      <wui-text variant="md-regular" color="secondary" align="center">
        Your connected wallet may not support some of the networks available for this dApp
      </wui-text>
      <wui-link @click=${this.onNetworkHelp.bind(this)}>
        <wui-icon size="sm" color="accent-primary" slot="iconLeft" name="helpCircle"></wui-icon>
        What is a network
      </wui-link>
    </wui-flex>`}onNetworkHelp(){D.sendEvent({type:"track",event:"CLICK_NETWORK_HELP"}),w.push("WhatIsANetwork")}getWrapper(){return this.shadowRoot?.querySelector("div.container")}};Ie.styles=[Po];pt([p()],Ie.prototype,"status",void 0);pt([p()],Ie.prototype,"view",void 0);Ie=pt([m("w3m-footer")],Ie);var To=f`
  :host {
    display: block;
    width: inherit;
  }
`;var dt=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},Ne=class extends h{constructor(){super(),this.unsubscribe=[],this.viewState=w.state.view,this.history=w.state.history.join(","),this.unsubscribe.push(w.subscribeKey("view",()=>{this.history=w.state.history.join(","),document.documentElement.style.setProperty("--apkt-duration-dynamic","var(--apkt-durations-lg)")}))}disconnectedCallback(){this.unsubscribe.forEach(t=>t()),document.documentElement.style.setProperty("--apkt-duration-dynamic","0s")}render(){return a`${this.templatePageContainer()}`}templatePageContainer(){return a`<w3m-router-container
      history=${this.history}
      .setView=${()=>{this.viewState=w.state.view}}
    >
      ${this.viewTemplate(this.viewState)}
    </w3m-router-container>`}viewTemplate(t){switch(t){case"AccountSettings":return a`<w3m-account-settings-view></w3m-account-settings-view>`;case"Account":return a`<w3m-account-view></w3m-account-view>`;case"AllWallets":return a`<w3m-all-wallets-view></w3m-all-wallets-view>`;case"ApproveTransaction":return a`<w3m-approve-transaction-view></w3m-approve-transaction-view>`;case"BuyInProgress":return a`<w3m-buy-in-progress-view></w3m-buy-in-progress-view>`;case"ChooseAccountName":return a`<w3m-choose-account-name-view></w3m-choose-account-name-view>`;case"Connect":return a`<w3m-connect-view></w3m-connect-view>`;case"Create":return a`<w3m-connect-view walletGuide="explore"></w3m-connect-view>`;case"ConnectingWalletConnect":return a`<w3m-connecting-wc-view></w3m-connecting-wc-view>`;case"ConnectingWalletConnectBasic":return a`<w3m-connecting-wc-basic-view></w3m-connecting-wc-basic-view>`;case"ConnectingExternal":return a`<w3m-connecting-external-view></w3m-connecting-external-view>`;case"ConnectingSiwe":return a`<w3m-connecting-siwe-view></w3m-connecting-siwe-view>`;case"ConnectWallets":return a`<w3m-connect-wallets-view></w3m-connect-wallets-view>`;case"ConnectSocials":return a`<w3m-connect-socials-view></w3m-connect-socials-view>`;case"ConnectingSocial":return a`<w3m-connecting-social-view></w3m-connecting-social-view>`;case"DataCapture":return a`<w3m-data-capture-view></w3m-data-capture-view>`;case"DataCaptureOtpConfirm":return a`<w3m-data-capture-otp-confirm-view></w3m-data-capture-otp-confirm-view>`;case"Downloads":return a`<w3m-downloads-view></w3m-downloads-view>`;case"EmailLogin":return a`<w3m-email-login-view></w3m-email-login-view>`;case"EmailVerifyOtp":return a`<w3m-email-verify-otp-view></w3m-email-verify-otp-view>`;case"EmailVerifyDevice":return a`<w3m-email-verify-device-view></w3m-email-verify-device-view>`;case"GetWallet":return a`<w3m-get-wallet-view></w3m-get-wallet-view>`;case"Networks":return a`<w3m-networks-view></w3m-networks-view>`;case"SwitchNetwork":return a`<w3m-network-switch-view></w3m-network-switch-view>`;case"ProfileWallets":return a`<w3m-profile-wallets-view></w3m-profile-wallets-view>`;case"Transactions":return a`<w3m-transactions-view></w3m-transactions-view>`;case"OnRampProviders":return a`<w3m-onramp-providers-view></w3m-onramp-providers-view>`;case"OnRampTokenSelect":return a`<w3m-onramp-token-select-view></w3m-onramp-token-select-view>`;case"OnRampFiatSelect":return a`<w3m-onramp-fiat-select-view></w3m-onramp-fiat-select-view>`;case"UpgradeEmailWallet":return a`<w3m-upgrade-wallet-view></w3m-upgrade-wallet-view>`;case"UpdateEmailWallet":return a`<w3m-update-email-wallet-view></w3m-update-email-wallet-view>`;case"UpdateEmailPrimaryOtp":return a`<w3m-update-email-primary-otp-view></w3m-update-email-primary-otp-view>`;case"UpdateEmailSecondaryOtp":return a`<w3m-update-email-secondary-otp-view></w3m-update-email-secondary-otp-view>`;case"UnsupportedChain":return a`<w3m-unsupported-chain-view></w3m-unsupported-chain-view>`;case"Swap":return a`<w3m-swap-view></w3m-swap-view>`;case"SwapSelectToken":return a`<w3m-swap-select-token-view></w3m-swap-select-token-view>`;case"SwapPreview":return a`<w3m-swap-preview-view></w3m-swap-preview-view>`;case"WalletSend":return a`<w3m-wallet-send-view></w3m-wallet-send-view>`;case"WalletSendSelectToken":return a`<w3m-wallet-send-select-token-view></w3m-wallet-send-select-token-view>`;case"WalletSendPreview":return a`<w3m-wallet-send-preview-view></w3m-wallet-send-preview-view>`;case"WalletSendConfirmed":return a`<w3m-send-confirmed-view></w3m-send-confirmed-view>`;case"WhatIsABuy":return a`<w3m-what-is-a-buy-view></w3m-what-is-a-buy-view>`;case"WalletReceive":return a`<w3m-wallet-receive-view></w3m-wallet-receive-view>`;case"WalletCompatibleNetworks":return a`<w3m-wallet-compatible-networks-view></w3m-wallet-compatible-networks-view>`;case"WhatIsAWallet":return a`<w3m-what-is-a-wallet-view></w3m-what-is-a-wallet-view>`;case"ConnectingMultiChain":return a`<w3m-connecting-multi-chain-view></w3m-connecting-multi-chain-view>`;case"WhatIsANetwork":return a`<w3m-what-is-a-network-view></w3m-what-is-a-network-view>`;case"ConnectingFarcaster":return a`<w3m-connecting-farcaster-view></w3m-connecting-farcaster-view>`;case"SwitchActiveChain":return a`<w3m-switch-active-chain-view></w3m-switch-active-chain-view>`;case"RegisterAccountName":return a`<w3m-register-account-name-view></w3m-register-account-name-view>`;case"RegisterAccountNameSuccess":return a`<w3m-register-account-name-success-view></w3m-register-account-name-success-view>`;case"SmartSessionCreated":return a`<w3m-smart-session-created-view></w3m-smart-session-created-view>`;case"SmartSessionList":return a`<w3m-smart-session-list-view></w3m-smart-session-list-view>`;case"SIWXSignMessage":return a`<w3m-siwx-sign-message-view></w3m-siwx-sign-message-view>`;case"Pay":return a`<w3m-pay-view></w3m-pay-view>`;case"PayLoading":return a`<w3m-pay-loading-view></w3m-pay-loading-view>`;case"PayQuote":return a`<w3m-pay-quote-view></w3m-pay-quote-view>`;case"FundWallet":return a`<w3m-fund-wallet-view></w3m-fund-wallet-view>`;case"PayWithExchange":return a`<w3m-deposit-from-exchange-view></w3m-deposit-from-exchange-view>`;case"PayWithExchangeSelectAsset":return a`<w3m-deposit-from-exchange-select-asset-view></w3m-deposit-from-exchange-select-asset-view>`;case"UsageExceeded":return a`<w3m-usage-exceeded-view></w3m-usage-exceeded-view>`;case"SmartAccountSettings":return a`<w3m-smart-account-settings-view></w3m-smart-account-settings-view>`;default:return a`<w3m-connect-view></w3m-connect-view>`}}};Ne.styles=[To];dt([p()],Ne.prototype,"viewState",void 0);dt([p()],Ne.prototype,"history",void 0);Ne=dt([m("w3m-router")],Ne);var $o=f`
  :host {
    z-index: ${({tokens:e})=>e.core.zIndex};
    display: block;
    backface-visibility: hidden;
    will-change: opacity;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    opacity: 0;
    background-color: ${({tokens:e})=>e.theme.overlay};
    backdrop-filter: blur(0px);
    transition:
      opacity ${({durations:e})=>e.lg} ${({easings:e})=>e["ease-out-power-2"]},
      backdrop-filter ${({durations:e})=>e.lg}
        ${({easings:e})=>e["ease-out-power-2"]};
    will-change: opacity;
  }

  :host(.open) {
    opacity: 1;
    backdrop-filter: blur(8px);
  }

  :host(.appkit-modal) {
    position: relative;
    pointer-events: unset;
    background: none;
    width: 100%;
    opacity: 1;
  }

  wui-card {
    max-width: var(--apkt-modal-width);
    width: 100%;
    position: relative;
    outline: none;
    transform: translateY(4px);
    box-shadow: 0 2px 8px 0 rgba(0, 0, 0, 0.05);
    transition:
      transform ${({durations:e})=>e.lg}
        ${({easings:e})=>e["ease-out-power-2"]},
      border-radius ${({durations:e})=>e.lg}
        ${({easings:e})=>e["ease-out-power-1"]},
      background-color ${({durations:e})=>e.lg}
        ${({easings:e})=>e["ease-out-power-1"]},
      box-shadow ${({durations:e})=>e.lg}
        ${({easings:e})=>e["ease-out-power-1"]};
    will-change: border-radius, background-color, transform, box-shadow;
    background-color: ${({tokens:e})=>e.theme.backgroundPrimary};
    padding: var(--local-modal-padding);
    box-sizing: border-box;
  }

  :host(.open) wui-card {
    transform: translateY(0px);
  }

  wui-card::before {
    z-index: 1;
    pointer-events: none;
    content: '';
    position: absolute;
    inset: 0;
    border-radius: clamp(0px, var(--apkt-borderRadius-8), 44px);
    transition: box-shadow ${({durations:e})=>e.lg}
      ${({easings:e})=>e["ease-out-power-2"]};
    transition-delay: ${({durations:e})=>e.md};
    will-change: box-shadow;
  }

  :host([data-mobile-fullscreen='true']) wui-card::before {
    border-radius: 0px;
  }

  :host([data-border='true']) wui-card::before {
    box-shadow: inset 0px 0px 0px 4px ${({tokens:e})=>e.theme.foregroundSecondary};
  }

  :host([data-border='false']) wui-card::before {
    box-shadow: inset 0px 0px 0px 1px ${({tokens:e})=>e.theme.borderPrimaryDark};
  }

  :host([data-border='true']) wui-card {
    animation:
      fade-in ${({durations:e})=>e.lg} ${({easings:e})=>e["ease-out-power-2"]},
      card-background-border var(--apkt-duration-dynamic)
        ${({easings:e})=>e["ease-out-power-2"]};
    animation-fill-mode: backwards, both;
    animation-delay: var(--apkt-duration-dynamic);
  }

  :host([data-border='false']) wui-card {
    animation:
      fade-in ${({durations:e})=>e.lg} ${({easings:e})=>e["ease-out-power-2"]},
      card-background-default var(--apkt-duration-dynamic)
        ${({easings:e})=>e["ease-out-power-2"]};
    animation-fill-mode: backwards, both;
    animation-delay: 0s;
  }

  :host(.appkit-modal) wui-card {
    max-width: var(--apkt-modal-width);
  }

  wui-card[shake='true'] {
    animation:
      fade-in ${({durations:e})=>e.lg} ${({easings:e})=>e["ease-out-power-2"]},
      w3m-shake ${({durations:e})=>e.xl}
        ${({easings:e})=>e["ease-out-power-2"]};
  }

  wui-flex {
    overflow-x: hidden;
    overflow-y: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }

  @media (max-height: 700px) and (min-width: 431px) {
    wui-flex {
      align-items: flex-start;
    }

    wui-card {
      margin: var(--apkt-spacing-6) 0px;
    }
  }

  @media (max-width: 430px) {
    :host([data-mobile-fullscreen='true']) {
      height: 100dvh;
    }
    :host([data-mobile-fullscreen='true']) wui-flex {
      align-items: stretch;
    }
    :host([data-mobile-fullscreen='true']) wui-card {
      max-width: 100%;
      height: 100%;
      border-radius: 0;
      border: none;
    }
    :host(:not([data-mobile-fullscreen='true'])) wui-flex {
      align-items: flex-end;
    }

    :host(:not([data-mobile-fullscreen='true'])) wui-card {
      max-width: 100%;
      border-bottom: none;
    }

    :host(:not([data-mobile-fullscreen='true'])) wui-card[data-embedded='true'] {
      border-bottom-left-radius: clamp(0px, var(--apkt-borderRadius-8), 44px);
      border-bottom-right-radius: clamp(0px, var(--apkt-borderRadius-8), 44px);
    }

    :host(:not([data-mobile-fullscreen='true'])) wui-card:not([data-embedded='true']) {
      border-bottom-left-radius: 0px;
      border-bottom-right-radius: 0px;
    }

    wui-card[shake='true'] {
      animation: w3m-shake 0.5s ${({easings:e})=>e["ease-out-power-2"]};
    }
  }

  @keyframes fade-in {
    0% {
      transform: scale(0.99) translateY(4px);
    }
    100% {
      transform: scale(1) translateY(0);
    }
  }

  @keyframes w3m-shake {
    0% {
      transform: scale(1) rotate(0deg);
    }
    20% {
      transform: scale(1) rotate(-1deg);
    }
    40% {
      transform: scale(1) rotate(1.5deg);
    }
    60% {
      transform: scale(1) rotate(-1.5deg);
    }
    80% {
      transform: scale(1) rotate(1deg);
    }
    100% {
      transform: scale(1) rotate(0deg);
    }
  }

  @keyframes card-background-border {
    from {
      background-color: ${({tokens:e})=>e.theme.backgroundPrimary};
    }
    to {
      background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    }
  }

  @keyframes card-background-default {
    from {
      background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    }
    to {
      background-color: ${({tokens:e})=>e.theme.backgroundPrimary};
    }
  }
`;var K=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},_o="scroll-lock",ur={PayWithExchange:"0",PayWithExchangeSelectAsset:"0",Pay:"0",PayQuote:"0",PayLoading:"0"},z=class extends h{constructor(){super(),this.unsubscribe=[],this.abortController=void 0,this.hasPrefetched=!1,this.enableEmbedded=v.state.enableEmbedded,this.open=$.state.open,this.caipAddress=g.state.activeCaipAddress,this.caipNetwork=g.state.activeCaipNetwork,this.shake=$.state.shake,this.filterByNamespace=P.state.filterByNamespace,this.padding=te.spacing[1],this.mobileFullScreen=v.state.enableMobileFullScreen,this.initializeTheming(),be.prefetchAnalyticsConfig(),this.unsubscribe.push($.subscribeKey("open",t=>t?this.onOpen():this.onClose()),$.subscribeKey("shake",t=>this.shake=t),g.subscribeKey("activeCaipNetwork",t=>this.onNewNetwork(t)),g.subscribeKey("activeCaipAddress",t=>this.onNewAddress(t)),v.subscribeKey("enableEmbedded",t=>this.enableEmbedded=t),P.subscribeKey("filterByNamespace",t=>{this.filterByNamespace!==t&&!g.getAccountData(t)?.caipAddress&&(be.fetchRecommendedWallets(),this.filterByNamespace=t)}),w.subscribeKey("view",()=>{this.dataset.border=me.hasFooter()?"true":"false",this.padding=ur[w.state.view]??te.spacing[1]}))}firstUpdated(){if(this.dataset.border=me.hasFooter()?"true":"false",this.mobileFullScreen&&this.setAttribute("data-mobile-fullscreen","true"),this.caipAddress){if(this.enableEmbedded){$.close(),this.prefetch();return}this.onNewAddress(this.caipAddress)}this.open&&this.onOpen(),this.enableEmbedded&&this.prefetch()}disconnectedCallback(){this.unsubscribe.forEach(t=>t()),this.onRemoveKeyboardListener()}render(){return this.style.setProperty("--local-modal-padding",this.padding),this.enableEmbedded?a`${this.contentTemplate()}
        <w3m-tooltip></w3m-tooltip> `:this.open?a`
          <wui-flex @click=${this.onOverlayClick.bind(this)} data-testid="w3m-modal-overlay">
            ${this.contentTemplate()}
          </wui-flex>
          <w3m-tooltip></w3m-tooltip>
        `:null}contentTemplate(){return a` <wui-card
      shake="${this.shake}"
      data-embedded="${b(this.enableEmbedded)}"
      role="alertdialog"
      aria-modal="true"
      tabindex="0"
      data-testid="w3m-modal-card"
    >
      <w3m-header></w3m-header>
      <w3m-router></w3m-router>
      <w3m-footer></w3m-footer>
      <w3m-snackbar></w3m-snackbar>
      <w3m-alertbar></w3m-alertbar>
    </wui-card>`}async onOverlayClick(t){if(t.target===t.currentTarget){if(this.mobileFullScreen)return;await this.handleClose()}}async handleClose(){await Pe.safeClose()}initializeTheming(){let{themeVariables:t,themeMode:o}=Et.state,i=re.getColorTheme(o);Nt(t,i)}onClose(){this.open=!1,this.classList.remove("open"),this.onScrollUnlock(),k.hide(),this.onRemoveKeyboardListener()}onOpen(){this.open=!0,this.classList.add("open"),this.onScrollLock(),this.onAddKeyboardListener()}onScrollLock(){let t=document.createElement("style");t.dataset.w3m=_o,t.textContent=`
      body {
        touch-action: none;
        overflow: hidden;
        overscroll-behavior: contain;
      }
      w3m-modal {
        pointer-events: auto;
      }
    `,document.head.appendChild(t)}onScrollUnlock(){let t=document.head.querySelector(`style[data-w3m="${_o}"]`);t&&t.remove()}onAddKeyboardListener(){this.abortController=new AbortController;let t=this.shadowRoot?.querySelector("wui-card");t?.focus(),window.addEventListener("keydown",o=>{if(o.key==="Escape")this.handleClose();else if(o.key==="Tab"){let{tagName:i}=o.target;i&&!i.includes("W3M-")&&!i.includes("WUI-")&&t?.focus()}},this.abortController)}onRemoveKeyboardListener(){this.abortController?.abort(),this.abortController=void 0}async onNewAddress(t){let o=g.state.isSwitchingNamespace,i=w.state.view==="ProfileWallets";!t&&!o&&!i&&$.close(),await At.initializeIfEnabled(t),this.caipAddress=t,g.setIsSwitchingNamespace(!1)}onNewNetwork(t){let i=this.caipNetwork?.caipNetworkId?.toString(),n=t?.caipNetworkId?.toString(),r=i!==n,s=w.state.view==="UnsupportedChain",c=$.state.open,E=!1;this.enableEmbedded&&w.state.view==="SwitchNetwork"&&(E=!0),r&&It.resetState(),c&&s&&(E=!0),E&&w.state.view!=="SIWXSignMessage"&&w.goBack(),this.caipNetwork=t}prefetch(){this.hasPrefetched||(be.prefetch(),be.fetchWalletsByPage({page:1}),this.hasPrefetched=!0)}};z.styles=$o;K([u({type:Boolean})],z.prototype,"enableEmbedded",void 0);K([p()],z.prototype,"open",void 0);K([p()],z.prototype,"caipAddress",void 0);K([p()],z.prototype,"caipNetwork",void 0);K([p()],z.prototype,"shake",void 0);K([p()],z.prototype,"filterByNamespace",void 0);K([p()],z.prototype,"padding",void 0);K([p()],z.prototype,"mobileFullScreen",void 0);var Ro=class extends z{};Ro=K([m("w3m-modal")],Ro);var Oo=class extends z{};Oo=K([m("appkit-modal")],Oo);var Uo=f`
  .icon-box {
    width: 64px;
    height: 64px;
    border-radius: ${({borderRadius:e})=>e[5]};
    background-color: ${({colors:e})=>e.semanticError010};
  }
`;var pr=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},mt=class extends h{constructor(){super()}render(){return a`
      <wui-flex
        flexDirection="column"
        alignItems="center"
        gap="4"
        .padding="${["1","3","4","3"]}"
      >
        <wui-flex justifyContent="center" alignItems="center" class="icon-box">
          <wui-icon size="xxl" color="error" name="warningCircle"></wui-icon>
        </wui-flex>

        <wui-text variant="lg-medium" color="primary" align="center">
          The app isn't responding as expected
        </wui-text>
        <wui-text variant="md-regular" color="secondary" align="center">
          Try again or reach out to the app team for help.
        </wui-text>

        <wui-button
          variant="neutral-secondary"
          size="md"
          @click=${this.onTryAgainClick.bind(this)}
          data-testid="w3m-usage-exceeded-button"
        >
          <wui-icon color="inherit" slot="iconLeft" name="refresh"></wui-icon>
          Try Again
        </wui-button>
      </wui-flex>
    `}onTryAgainClick(){w.goBack()}};mt.styles=Uo;mt=pr([m("w3m-usage-exceeded-view")],mt);var Do=f`
  :host {
    width: 100%;
  }
`;var O=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},T=class extends h{constructor(){super(...arguments),this.hasImpressionSent=!1,this.walletImages=[],this.imageSrc="",this.name="",this.size="md",this.tabIdx=void 0,this.disabled=!1,this.showAllWallets=!1,this.loading=!1,this.loadingSpinnerColor="accent-100",this.rdnsId="",this.displayIndex=void 0,this.walletRank=void 0,this.namespaces=[]}connectedCallback(){super.connectedCallback()}disconnectedCallback(){super.disconnectedCallback(),this.cleanupIntersectionObserver()}updated(t){super.updated(t),(t.has("name")||t.has("imageSrc")||t.has("walletRank"))&&(this.hasImpressionSent=!1),t.has("walletRank")&&this.walletRank&&!this.intersectionObserver&&this.setupIntersectionObserver()}setupIntersectionObserver(){this.intersectionObserver=new IntersectionObserver(t=>{t.forEach(o=>{o.isIntersecting&&!this.loading&&!this.hasImpressionSent&&this.sendImpressionEvent()})},{threshold:.1}),this.intersectionObserver.observe(this)}cleanupIntersectionObserver(){this.intersectionObserver&&(this.intersectionObserver.disconnect(),this.intersectionObserver=void 0)}sendImpressionEvent(){!this.name||this.hasImpressionSent||!this.walletRank||(this.hasImpressionSent=!0,(this.rdnsId||this.name)&&D.sendWalletImpressionEvent({name:this.name,walletRank:this.walletRank,rdnsId:this.rdnsId,view:w.state.view,displayIndex:this.displayIndex}))}handleGetWalletNamespaces(){return Object.keys(St.state.adapters).length>1?this.namespaces:[]}render(){return a`
      <wui-list-wallet
        .walletImages=${this.walletImages}
        imageSrc=${b(this.imageSrc)}
        name=${this.name}
        size=${b(this.size)}
        tagLabel=${b(this.tagLabel)}
        .tagVariant=${this.tagVariant}
        .walletIcon=${this.walletIcon}
        .tabIdx=${this.tabIdx}
        .disabled=${this.disabled}
        .showAllWallets=${this.showAllWallets}
        .loading=${this.loading}
        loadingSpinnerColor=${this.loadingSpinnerColor}
        .namespaces=${this.handleGetWalletNamespaces()}
      ></wui-list-wallet>
    `}};T.styles=Do;O([u({type:Array})],T.prototype,"walletImages",void 0);O([u()],T.prototype,"imageSrc",void 0);O([u()],T.prototype,"name",void 0);O([u()],T.prototype,"size",void 0);O([u()],T.prototype,"tagLabel",void 0);O([u()],T.prototype,"tagVariant",void 0);O([u()],T.prototype,"walletIcon",void 0);O([u()],T.prototype,"tabIdx",void 0);O([u({type:Boolean})],T.prototype,"disabled",void 0);O([u({type:Boolean})],T.prototype,"showAllWallets",void 0);O([u({type:Boolean})],T.prototype,"loading",void 0);O([u({type:String})],T.prototype,"loadingSpinnerColor",void 0);O([u()],T.prototype,"rdnsId",void 0);O([u()],T.prototype,"displayIndex",void 0);O([u()],T.prototype,"walletRank",void 0);O([u({type:Array})],T.prototype,"namespaces",void 0);T=O([m("w3m-list-wallet")],T);var Lo=f`
  :host {
    --local-duration-height: 0s;
    --local-duration: ${({durations:e})=>e.lg};
    --local-transition: ${({easings:e})=>e["ease-out-power-2"]};
  }

  .container {
    display: block;
    overflow: hidden;
    overflow: hidden;
    position: relative;
    height: var(--local-container-height);
    transition: height var(--local-duration-height) var(--local-transition);
    will-change: height, padding-bottom;
  }

  .container[data-mobile-fullscreen='true'] {
    overflow: scroll;
  }

  .page {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    width: 100%;
    height: auto;
    width: inherit;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    background-color: ${({tokens:e})=>e.theme.backgroundPrimary};
    border-bottom-left-radius: var(--local-border-bottom-radius);
    border-bottom-right-radius: var(--local-border-bottom-radius);
    transition: border-bottom-left-radius var(--local-duration) var(--local-transition);
  }

  .page[data-mobile-fullscreen='true'] {
    height: 100%;
  }

  .page-content {
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }

  .footer {
    height: var(--apkt-footer-height);
  }

  div.page[view-direction^='prev-'] .page-content {
    animation:
      slide-left-out var(--local-duration) forwards var(--local-transition),
      slide-left-in var(--local-duration) forwards var(--local-transition);
    animation-delay: 0ms, var(--local-duration, ${({durations:e})=>e.lg});
  }

  div.page[view-direction^='next-'] .page-content {
    animation:
      slide-right-out var(--local-duration) forwards var(--local-transition),
      slide-right-in var(--local-duration) forwards var(--local-transition);
    animation-delay: 0ms, var(--local-duration, ${({durations:e})=>e.lg});
  }

  @keyframes slide-left-out {
    from {
      transform: translateX(0px) scale(1);
      opacity: 1;
      filter: blur(0px);
    }
    to {
      transform: translateX(8px) scale(0.99);
      opacity: 0;
      filter: blur(4px);
    }
  }

  @keyframes slide-left-in {
    from {
      transform: translateX(-8px) scale(0.99);
      opacity: 0;
      filter: blur(4px);
    }
    to {
      transform: translateX(0) translateY(0) scale(1);
      opacity: 1;
      filter: blur(0px);
    }
  }

  @keyframes slide-right-out {
    from {
      transform: translateX(0px) scale(1);
      opacity: 1;
      filter: blur(0px);
    }
    to {
      transform: translateX(-8px) scale(0.99);
      opacity: 0;
      filter: blur(4px);
    }
  }

  @keyframes slide-right-in {
    from {
      transform: translateX(8px) scale(0.99);
      opacity: 0;
      filter: blur(4px);
    }
    to {
      transform: translateX(0) translateY(0) scale(1);
      opacity: 1;
      filter: blur(0px);
    }
  }
`;var Q=function(e,t,o,i){var n=arguments.length,r=n<3?t:i===null?i=Object.getOwnPropertyDescriptor(t,o):i,s;if(typeof Reflect=="object"&&typeof Reflect.decorate=="function")r=Reflect.decorate(e,t,o,i);else for(var c=e.length-1;c>=0;c--)(s=e[c])&&(r=(n<3?s(r):n>3?s(t,o,r):s(t,o))||r);return n>3&&r&&Object.defineProperty(t,o,r),r},dr=60,q=class extends h{constructor(){super(...arguments),this.resizeObserver=void 0,this.transitionDuration="0.15s",this.transitionFunction="",this.history="",this.view="",this.setView=void 0,this.viewDirection="",this.historyState="",this.previousHeight="0px",this.mobileFullScreen=v.state.enableMobileFullScreen,this.onViewportResize=()=>{this.updateContainerHeight()}}updated(t){if(t.has("history")){let o=this.history;this.historyState!==""&&this.historyState!==o&&this.onViewChange(o)}t.has("transitionDuration")&&this.style.setProperty("--local-duration",this.transitionDuration),t.has("transitionFunction")&&this.style.setProperty("--local-transition",this.transitionFunction)}firstUpdated(){this.transitionFunction&&this.style.setProperty("--local-transition",this.transitionFunction),this.style.setProperty("--local-duration",this.transitionDuration),this.historyState=this.history,this.resizeObserver=new ResizeObserver(t=>{for(let o of t)if(o.target===this.getWrapper()){let i=o.contentRect.height,n=parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--apkt-footer-height")||"0");if(this.mobileFullScreen){let r=window.visualViewport?.height||window.innerHeight,s=this.getHeaderHeight();i=r-s-n,this.style.setProperty("--local-border-bottom-radius","0px")}else i=i+n,this.style.setProperty("--local-border-bottom-radius",n?"var(--apkt-borderRadius-5)":"0px");this.style.setProperty("--local-container-height",`${i}px`),this.previousHeight!=="0px"&&this.style.setProperty("--local-duration-height",this.transitionDuration),this.previousHeight=`${i}px`}}),this.resizeObserver.observe(this.getWrapper()),this.updateContainerHeight(),window.addEventListener("resize",this.onViewportResize),window.visualViewport?.addEventListener("resize",this.onViewportResize)}disconnectedCallback(){let t=this.getWrapper();t&&this.resizeObserver&&this.resizeObserver.unobserve(t),window.removeEventListener("resize",this.onViewportResize),window.visualViewport?.removeEventListener("resize",this.onViewportResize)}render(){return a`
      <div class="container" data-mobile-fullscreen="${b(this.mobileFullScreen)}">
        <div
          class="page"
          data-mobile-fullscreen="${b(this.mobileFullScreen)}"
          view-direction="${this.viewDirection}"
        >
          <div class="page-content">
            <slot></slot>
          </div>
        </div>
      </div>
    `}onViewChange(t){let o=t.split(",").filter(Boolean),i=this.historyState.split(",").filter(Boolean),n=i.length,r=o.length,s=o[o.length-1]||"",c=re.cssDurationToNumber(this.transitionDuration),E="";r>n?E="next":r<n?E="prev":r===n&&o[r-1]!==i[n-1]&&(E="next"),this.viewDirection=`${E}-${s}`,setTimeout(()=>{this.historyState=t,this.setView?.(s)},c),setTimeout(()=>{this.viewDirection=""},c*2)}getWrapper(){return this.shadowRoot?.querySelector("div.page")}updateContainerHeight(){let t=this.getWrapper();if(!t)return;let o=parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--apkt-footer-height")||"0"),i=0;if(this.mobileFullScreen){let n=window.visualViewport?.height||window.innerHeight,r=this.getHeaderHeight();i=n-r-o,this.style.setProperty("--local-border-bottom-radius","0px")}else i=t.getBoundingClientRect().height+o,this.style.setProperty("--local-border-bottom-radius",o?"var(--apkt-borderRadius-5)":"0px");this.style.setProperty("--local-container-height",`${i}px`),this.previousHeight!=="0px"&&this.style.setProperty("--local-duration-height",this.transitionDuration),this.previousHeight=`${i}px`}getHeaderHeight(){return dr}};q.styles=[Lo];Q([u({type:String})],q.prototype,"transitionDuration",void 0);Q([u({type:String})],q.prototype,"transitionFunction",void 0);Q([u({type:String})],q.prototype,"history",void 0);Q([u({type:String})],q.prototype,"view",void 0);Q([u({attribute:!1})],q.prototype,"setView",void 0);Q([p()],q.prototype,"viewDirection",void 0);Q([p()],q.prototype,"historyState",void 0);Q([p()],q.prototype,"previousHeight",void 0);Q([p()],q.prototype,"mobileFullScreen",void 0);q=Q([m("w3m-router-container")],q);export{Oo as AppKitModal,T as W3mListWallet,Ro as W3mModal,z as W3mModalBase,q as W3mRouterContainer,mt as W3mUsageExceededView};
