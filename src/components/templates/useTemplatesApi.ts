"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  BlankBudgetTemplateLine,
  BlankRetroTemplateTask,
  BlankWeeklyTemplate,
  ProjectCategory,
} from "@/lib/templates/project-templates";
import { showToast } from "@/lib/toast";

export interface CategoryTemplateEntry {
  category: ProjectCategory;
  meta: {
    label: string;
    shortLabel: string;
    description: string;
    badgeClass: string;
  };
  budgetLines: BlankBudgetTemplateLine[];
}

export interface TemplatesBundle {
  categories: CategoryTemplateEntry[];
  retroTasks: BlankRetroTemplateTask[];
  weeklyTemplate: BlankWeeklyTemplate;
}

export function useTemplatesApi() {
  const [data, setData] = useState<TemplatesBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/templates", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as TemplatesBundle;
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const init = async () => {
      await Promise.resolve();
      if (active) await load();
    };
    void init();
    return () => {
      active = false;
    };
  }, [load]);

  async function saveBudgetTemplate(
    category: ProjectCategory,
    budgetLines: BlankBudgetTemplateLine[]
  ) {
    setSaving(true);
    try {
      const res = await fetch("/api/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: category, budgetLines }),
      });
      if (!res.ok) {
        showToast("Impossible d'enregistrer le modèle budget.");
        return false;
      }
      showToast("Modèle vierge budget enregistré.");
      await load();
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function saveRetroTemplate(retroTasks: BlankRetroTemplateTask[]) {
    setSaving(true);
    try {
      const res = await fetch("/api/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "RETRO_GLOBAL", retroTasks }),
      });
      if (!res.ok) {
        showToast("Impossible d'enregistrer le modèle rétroplanning.");
        return false;
      }
      showToast("Modèle vierge rétroplanning enregistré.");
      await load();
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function saveWeeklyTemplate(weeklyTemplate: BlankWeeklyTemplate) {
    setSaving(true);
    try {
      const res = await fetch("/api/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "WEEKLY_GLOBAL", weeklyTemplate }),
      });
      if (!res.ok) {
        showToast("Impossible d'enregistrer le modèle Weekly.");
        return false;
      }
      showToast("Modèle vierge Weekly enregistré.");
      await load();
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function resetTemplate(
    target: ProjectCategory | "RETRO_GLOBAL" | "WEEKLY_GLOBAL"
  ) {
    setSaving(true);
    try {
      const res = await fetch("/api/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, reset: true }),
      });
      if (!res.ok) {
        showToast("Impossible de réinitialiser le modèle.");
        return false;
      }
      showToast("Modèle réinitialisé par défaut.");
      await load();
      return true;
    } finally {
      setSaving(false);
    }
  }

  return {
    data,
    loading,
    saving,
    reload: load,
    saveBudgetTemplate,
    saveRetroTemplate,
    saveWeeklyTemplate,
    resetTemplate,
  };
}
