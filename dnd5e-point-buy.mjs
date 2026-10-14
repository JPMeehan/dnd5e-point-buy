const moduleId = "dnd5e-point-buy";
const modulePath = (path) => `modules/${moduleId}/${path}`;
const {api, sheets} = foundry.applications;

class PointBuyCalculator extends api.HandlebarsApplicationMixin(sheets.ActorSheet) {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["standard-form", "pb-calculator"],
    window: {
      icon: "fa-solid fa-calculator"
    },
    actions: {
      reset: this.#reset
    },
    form: {
      closeOnSubmit: true
    }
  };

  /** @override */
  static PARTS = {
    header: {
      template: modulePath("templates/header.hbs")
    },
    body: {
      template: modulePath("templates/body.hbs")
    },
    footer: {
      template: "templates/generic/form-footer.hbs"
    }
  };

  /**
   * Resets the scores object
   * @this PointBuyCalculator
   * @param {PointerEvent} _event - The originating click event
   * @param {HTMLElement} _target - The capturing HTML element which defines the [data-action]
   */
  static async #reset(_event, _target) {
    this.scores = this._resetScores();
    await this.render();
  }

  /**
   * Tracks the ability score for each ability
   * @type {Record<string, number>}
   */
  scores = this._resetScores();

  /**
   * Grabs the base ability scores of the character
   * @returns {Record<string, number>} - The live ability scores
   */
  _resetScores() {
    const advancements = this.#evaluateAdvancements();

    return Object.keys(CONFIG.DND5E.abilities).reduce((obj, key) => {
      obj[key] = foundry.utils.getProperty(this.actor, `system.abilities.${key}.value`);
      for (const v of Object.values(advancements)) {
        obj[key] -= v[key];
      }
      return obj;
    }, {});
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    Object.assign(context, {
      actor: this.document,
      advancements: this.#evaluateAdvancements()
    });

    return context;
  }


  async _postRender(context, options) {
    if ( options.isFirstRender ) this.element.querySelector("input")?.focus();
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    await super._preparePartContext(partId, context, options);

    /** @type {Record<number, number>} */
    const costs = game.settings.get(moduleId, "pointCosts");
    const scores = Object.keys(costs).map((i) => Number(i));
    const minScore = scores[0];
    const maxScore = scores[scores.length - 1];

    switch (partId) {
      case "header":
        context.points = {
          current: Object.values(this.scores).reduce((total, score) => total + costs[score], 0),
          max: game.settings.get(moduleId, "pointMax")
        };
        break;
      case "body":
        context.abilities = Object.keys(CONFIG.DND5E.abilities).reduce((abilities, key) => {

          abilities[key] = {
            label: CONFIG.DND5E.abilities[key].label,
            base: this.scores[key],
            min: minScore,
            max: maxScore,
            total: this.scores[key],
            advancements: {}
          };

          for (const [identifier, bonus] of Object.entries(context.advancements)) {
            abilities[key].total += bonus[key];
            abilities[key].advancements[identifier] = bonus[key];
          }

          abilities[key].modifier = Math.floor((abilities[key].total - 10) / 2);

          return abilities;
        }, {});
        break;
      case "footer":
        context.buttons = [
          {type: "submit", icon: "fa-solid fa-save", label: "DND5EPointBuy.SubmitCalculation"},
          {type: "button", icon: "fa-solid fa-rotate-left", label: "DND5EPointBuy.Reset", action: "reset"}
        ];
        break;
    }

    return context;
  }

  /**
   * Simmer down advancements to just what's been applied to ability scores
   * @returns {Record<string, {label: string} & Record<string, number | null>>}
   */
  #evaluateAdvancements() {
    const advancementItems = this.actor.items.filter(i => i.hasAdvancement);

    const allASI = advancementItems.map(i => i.advancement.byType.AbilityScoreImprovement).deepFlatten();

    const appliedASI = allASI.filter(a => !foundry.utils.isEmpty(a?.value?.assignments));

    return appliedASI.reduce((abilities, a) => {
      const identifier = a.item.system.identifier;
      abilities[identifier] ??= Object.keys(CONFIG.DND5E.abilities).reduce((defaults, key) => {
        defaults[key] = null;
        return defaults;
      }, {
        label: a.item.name
      });

      for (const [key, value] of Object.entries(a.value.assignments)) {
        abilities[identifier][key] += value;
      }

      return abilities;
    }, {});
  }

  async _onChangeForm(_formConfig, _event) {
    const fd = new FormDataExtended(this.element);
    this.scores = Object.keys(CONFIG.DND5E.abilities).reduce((obj, key) => {
      obj[key] = foundry.utils.getProperty(fd.object, `system.abilities.${key}.value`);
      return obj;
    }, {});
    if (this.rendered) await this.render();
  }

  _processFormData(event, form, formData) {
    const advancements = this.#evaluateAdvancements();
    for (const key of Object.keys(CONFIG.DND5E.abilities)) {
      for (const v of Object.values(advancements)) {
        formData.object[`system.abilities.${key}.value`] += v[key];
      }
    }

    return super._processFormData(event, form, formData);
  }
}

class PointCostMenu extends api.HandlebarsApplicationMixin(api.Application) {
  static DEFAULT_OPTIONS = {
    id: moduleId + "pointCostMenu",
    classes: ["standard-form", "pointCostMenu"],
    tag: "form",
    window: {
      title: "DND5EPointBuy.PointCosts.title",
      icon: "fa-solid fa-calculator"
    },
    position: {
      width: 200
    },
    actions: {
      resetDefaults: this.#resetDefaults
    },
    form: {
      handler: this.#onSubmitSetting,
      closeOnSubmit: true
    }
  }

  static get defaultCosts() {
    return {
      8: 0,
      9: 1,
      10: 2,
      11: 3,
      12: 4,
      13: 5,
      14: 7,
      15: 9
    }
  }

  static PARTS = {
    body: {
      template: modulePath("templates/cost-menu.hbs")
    },
    footer: {
      template: "templates/generic/form-footer.hbs"
    }
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  _prepareContext(options) {
    return {
      pointCosts: options.reset ? this.constructor.defaultCosts : game.settings.get(moduleId, "pointCosts"),
      buttons: [
        {
          type: "submit",
          name: "submit",
          icon: "fa-solid fa-floppy-disk",
          label: "EDITOR.Save"
        },
        {
          type: "reset",
          name: "reset",
          icon: "fa-solid fa-arrow-rotate-left",
          label: "SETTINGS.Reset",
          action: "resetDefaults",
        }
      ]
    }
  }

  /* -------------------------------------------- */
  /*  Event Handlers                              */
  /* -------------------------------------------- */

  /**
   * @this PointCostMenu
   * @param {PointerEvent} event  The originating click event
   * @param {HTMLElement} target  The capturing HTML element which defines the [data-action]
   */
  static async #resetDefaults(event, target) {
    this.render({ reset: true })
  }

  /**
   * A form submission handler method.
   * @this PointCostMenu
   * @param {SubmitEvent|Event} event   The originating form submission or input change event
   * @param {HTMLFormElement} form      The form element that was submitted
   * @param {FormDataExtended} formData Processed data for the submitted form
   */
  static async #onSubmitSetting(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object).score
    game.settings.set(moduleId, "pointCosts", data);
  }
}

Hooks.once("init", () => {
  const m = game.modules.get(moduleId);
  m.PointBuyCalculator = PointBuyCalculator;

  const fields = foundry.data.fields;

  game.settings.register(moduleId, "pointMax", {
    name: "DND5EPointBuy.MaxPoints.name",
    hint: "DND5EPointBuy.MaxPoints.hint",
    scope: "world",
    config: true,
    type: new fields.NumberField({required: true, nullable: false}),
    default: 27
  });

  const pointField = () => new fields.NumberField({required: true, nullable: false});

  game.settings.register(moduleId, "pointCosts", {
    scope: "world",
    config: false,
    type: new fields.SchemaField({
      8: pointField(),
      9: pointField(),
      10: pointField(),
      11: pointField(),
      12: pointField(),
      13: pointField(),
      14: pointField(),
      15: pointField()
    }),
    default: PointCostMenu.defaultCosts
  });

  game.settings.registerMenu(moduleId, "pointCostMenu", {
    name: "DND5EPointBuy.PointCosts.name",
    label: "DND5EPointBuy.PointCosts.label",
    hint: "DND5EPointBuy.PointCosts.hint",
    icon: "fa-solid fa-calculator",
    type: PointCostMenu,
    restricted: true
  })
});

/**
 * Adds an entry to Character actors to open the Point Buy app
 * @param {object} app
 * @param {Array<object>} entries
 */
function addContextMenuEntries(app, entries) {
  const index = entries.findIndex(el => el.name === "OWNERSHIP.Configure");
  const liToActor = (html) => game.actors.get(html.dataset.entryId);

  entries.splice(index, 0, {
    name: "DND5EPointBuy.MenuLabel",
    icon: "<i class=\"fa-solid fa-calculator\"></i>",
    condition: (html) => {
      const actor = liToActor(html);
      return (actor?.type === "character") && actor?.isOwner;
    },
    callback: (html) => {
      new PointBuyCalculator({document: liToActor(html)}).render({force: true});
    }
  });
}

Hooks.on("getActorContextOptions", addContextMenuEntries);
