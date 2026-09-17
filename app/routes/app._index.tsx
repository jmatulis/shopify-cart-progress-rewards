import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import {
  MAX_TIERS,
  validateConfig,
  type RewardsConfig,
  type ValidationErrors,
} from "../lib/rewards";
import {
  getRewardsSettings,
  saveRewardsConfig,
} from "../models/rewards.server";

// Runs on the server for GET requests: read the saved config from the metafield.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const { config, currencyCode, isSaved } = await getRewardsSettings(admin);
  return { config, currencyCode, isSaved };
};

// Runs on the server for POST requests: validate, then write the metafield.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const { config, errors } = validateConfig(await request.json());
  if (Object.keys(errors).length > 0) {
    return data({ ok: false as const, errors }, { status: 422 });
  }

  const { appInstallationId } = await getRewardsSettings(admin);
  const userErrors = await saveRewardsConfig(admin, appInstallationId, config);
  if (userErrors.length > 0) {
    return data(
      { ok: false as const, errors: { form: userErrors[0].message } },
      { status: 422 },
    );
  }
  return { ok: true as const };
};

/** Immutably sets a dotted path like "tiers.0.label" on the config. */
function setPath(config: RewardsConfig, path: string, value: unknown) {
  const next = structuredClone(config) as unknown as Record<string, unknown>;
  const keys = path.split(".");
  let target = next;
  for (const key of keys.slice(0, -1)) {
    target = target[key] as Record<string, unknown>;
  }
  target[keys[keys.length - 1]] = value;
  return next as unknown as RewardsConfig;
}

export default function RewardsDashboard() {
  const {
    config: savedConfig,
    currencyCode,
    isSaved,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [config, setConfig] = useState(savedConfig);
  // After a save, React Router re-runs the loader. When fresh saved data
  // arrives, reset the form to it (sorted tiers, trimmed labels).
  const [lastSaved, setLastSaved] = useState(savedConfig);
  if (savedConfig !== lastSaved) {
    setLastSaved(savedConfig);
    setConfig(savedConfig);
  }
  const [previewTotal, setPreviewTotal] = useState(35);
  const pageRef = useRef<HTMLElementTagNameMap["s-page"]>(null);

  const errors: ValidationErrors =
    fetcher.data && !fetcher.data.ok ? fetcher.data.errors : {};
  const isSaving = fetcher.state !== "idle";
  const isDirty = JSON.stringify(config) !== JSON.stringify(savedConfig);

  // Polaris web components emit native DOM events. React 18 doesn't wire
  // `onChange` to custom elements reliably, so we listen on the page in the
  // capture phase and route each field's value by its `name`.
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const handle = (event: Event) => {
      const field = event.target as HTMLInputElement & { name?: string };
      if (!field.name) return;
      if (field.name === "previewTotal") {
        setPreviewTotal(Number(field.value) || 0);
        return;
      }
      const value =
        field.name === "enabled"
          ? field.checked
          : field.name.endsWith(".threshold")
            ? field.value === ""
              ? ""
              : Number(field.value)
            : field.value;
      setConfig((current) => setPath(current, field.name, value));
    };
    page.addEventListener("input", handle, true);
    page.addEventListener("change", handle, true);
    return () => {
      page.removeEventListener("input", handle, true);
      page.removeEventListener("change", handle, true);
    };
  }, []);

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) {
      shopify.toast.show("Rewards saved");
    } else {
      shopify.toast.show("Fix the highlighted fields", { isError: true });
    }
  }, [fetcher.data, shopify]);

  const save = () =>
    fetcher.submit(config as never, {
      method: "POST",
      encType: "application/json",
    });

  const addTier = () => {
    const highest = Math.max(0, ...config.tiers.map((t) => t.threshold || 0));
    setConfig({
      ...config,
      tiers: [
        ...config.tiers,
        { id: `tier-${Date.now()}`, threshold: highest + 50, label: "" },
      ],
    });
  };

  const removeTier = (id: string) =>
    setConfig({ ...config, tiers: config.tiers.filter((t) => t.id !== id) });

  return (
    <s-page ref={pageRef} heading="Cart Progress Rewards">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={save}
        {...(isSaving ? { loading: true } : {})}
        {...(!isDirty && isSaved ? { disabled: true } : {})}
      >
        Save
      </s-button>

      <s-stack direction="block" gap="base">
        {errors.form && (
          <s-banner tone="critical" heading="Couldn't save">
            {errors.form}
          </s-banner>
        )}
        {!isSaved && (
          <s-banner tone="info" heading="Not saved yet">
            These are starter tiers. Save them so your storefront can read them.
          </s-banner>
        )}

        <s-section heading="Status">
          <s-checkbox
            name="enabled"
            label="Show the progress bar on my store"
            {...(config.enabled ? { checked: true } : {})}
          />
        </s-section>

        <s-section heading="Reward tiers">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Customers unlock each reward when their cart subtotal reaches the
              amount. Tiers are sorted by amount when you save.
            </s-paragraph>
            {errors.tiers && (
              <s-banner tone="critical">{errors.tiers}</s-banner>
            )}
            {config.tiers.map((tier, index) => (
              <s-grid
                key={tier.id}
                gridTemplateColumns="1fr 2fr auto"
                gap="base"
                alignItems="end"
              >
                <s-number-field
                  name={`tiers.${index}.threshold`}
                  label="Cart amount"
                  prefix={currencyCode}
                  min={0}
                  step={1}
                  value={String(tier.threshold)}
                  error={errors[`tiers.${index}.threshold`]}
                />
                <s-text-field
                  name={`tiers.${index}.label`}
                  label="Reward"
                  placeholder="Free shipping"
                  value={tier.label}
                  error={errors[`tiers.${index}.label`]}
                />
                <s-button
                  variant="tertiary"
                  tone="critical"
                  icon="delete"
                  accessibilityLabel={`Remove tier ${index + 1}`}
                  onClick={() => removeTier(tier.id)}
                />
              </s-grid>
            ))}
            {config.tiers.length < MAX_TIERS && (
              <s-button icon="plus" onClick={addTier}>
                Add tier
              </s-button>
            )}
          </s-stack>
        </s-section>

        <s-section heading="Messages">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Use <code>{"{amount}"}</code> for the money left and{" "}
              <code>{"{reward}"}</code> for the next reward.
            </s-paragraph>
            <s-text-field
              name="messages.empty"
              label="Empty cart"
              value={config.messages.empty}
            />
            <s-text-field
              name="messages.inProgress"
              label="Working toward a reward"
              value={config.messages.inProgress}
            />
            <s-text-field
              name="messages.complete"
              label="All rewards unlocked"
              value={config.messages.complete}
            />
          </s-stack>
        </s-section>

        <s-section heading="Style">
          <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
            <s-color-field
              name="style.barColor"
              label="Progress color"
              value={config.style.barColor}
              error={errors["style.barColor"]}
            />
            <s-color-field
              name="style.trackColor"
              label="Track color"
              value={config.style.trackColor}
              error={errors["style.trackColor"]}
            />
            <s-color-field
              name="style.textColor"
              label="Text color"
              value={config.style.textColor}
              error={errors["style.textColor"]}
            />
          </s-grid>
        </s-section>
      </s-stack>

      <s-section slot="aside" heading="Preview">
        <s-stack direction="block" gap="base">
          <s-number-field
            name="previewTotal"
            label="Sample cart subtotal"
            prefix={currencyCode}
            min={0}
            value={String(previewTotal)}
          />
          <ProgressPreview
            config={config}
            subtotal={previewTotal}
            currencyCode={currencyCode}
          />
        </s-stack>
      </s-section>
    </s-page>
  );
}

function ProgressPreview({
  config,
  subtotal,
  currencyCode,
}: {
  config: RewardsConfig;
  subtotal: number;
  currencyCode: string;
}) {
  const tiers = [...config.tiers]
    .filter((tier) => Number(tier.threshold) > 0)
    .sort((a, b) => a.threshold - b.threshold);
  if (tiers.length === 0) {
    return <s-text tone="neutral">Add a tier to see the preview.</s-text>;
  }

  const money = (amount: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
    }).format(amount);
  const max = tiers[tiers.length - 1].threshold;
  const next = tiers.find((tier) => subtotal < tier.threshold);
  const percent = Math.min(100, (subtotal / max) * 100);

  let message = config.messages.complete;
  if (next) {
    message = (
      subtotal > 0 ? config.messages.inProgress : config.messages.empty
    )
      .replaceAll("{amount}", money(next.threshold - subtotal))
      .replaceAll("{reward}", next.label || "your reward");
  }

  return (
    <div style={{ color: config.style.textColor, fontSize: 14 }}>
      <p style={{ margin: "0 0 8px" }}>{message}</p>
      <div
        style={{
          position: "relative",
          height: 10,
          borderRadius: 999,
          background: config.style.trackColor,
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: "100%",
            borderRadius: 999,
            background: config.style.barColor,
            transition: "width 200ms ease",
          }}
        />
      </div>
      {!config.enabled && (
        <p style={{ margin: "8px 0 0", opacity: 0.7 }}>
          (Hidden on your store while disabled)
        </p>
      )}
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
