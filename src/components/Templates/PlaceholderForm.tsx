import { useMemo, useState, useEffect } from "react";
import { VStack, Field, Input, Checkbox, Button, Textarea } from "@chakra-ui/react";
import {
  extractPlaceholderNames,
  extractConditionNames,
  renderTemplate,
} from "@/services/templateService";
import { fillPlaceholdersWithAI } from "@/services/claude";
import { toaster } from "@/components/ui/toaster";

export function PlaceholderForm(props: {
  templateBody: string;
  onApply: (markdown: string) => void;
  onCancel: () => void;
}) {
  const placeholders = useMemo(() => extractPlaceholderNames(props.templateBody), [props.templateBody]);
  const conditions = useMemo(() => extractConditionNames(props.templateBody), [props.templateBody]);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(placeholders.map((p) => [p, ""])),
  );
  const [condVals, setCondVals] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(conditions.map((c) => [c, false])),
  );
  const [aiBrief, setAiBrief] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    setValues(Object.fromEntries(placeholders.map((p) => [p, ""])));
    setCondVals(Object.fromEntries(conditions.map((c) => [c, false])));
    setAiBrief("");
  }, [props.templateBody, placeholders, conditions]);

  const apply = () => {
    const md = renderTemplate(props.templateBody, { placeholders: values, conditions: condVals });
    props.onApply(md);
  };

  const aiFill = async () => {
    if (!aiBrief.trim()) return;
    setAiBusy(true);
    try {
      const filled = await fillPlaceholdersWithAI(
        props.templateBody,
        aiBrief,
        placeholders,
        () => {},
      );
      setValues((prev) => ({ ...prev, ...filled }));
    } catch (e) {
      console.error(e);
      toaster.create({
        type: "error",
        title: "AI fill failed",
        description: (e as Error).message,
      });
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <VStack gap={3} align="stretch" p={4}>
      {placeholders.map((p) => (
        <Field.Root key={p}>
          <Field.Label fontSize="sm" color="fg">{`{{${p}}}`}</Field.Label>
          <Input
            size="sm"
            variant="outline"
            value={values[p] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [p]: e.target.value }))}
            bg="bg"
            borderColor="border"
          />
        </Field.Root>
      ))}
      {conditions.map((c) => (
        <Checkbox.Root
          key={c}
          checked={condVals[c]}
          onCheckedChange={(d) => setCondVals((v) => ({ ...v, [c]: d.checked === true }))}
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control borderColor="border.emphasized">
            <Checkbox.Indicator />
          </Checkbox.Control>
          <Checkbox.Label color="fg">{`{{#if ${c}}}`}</Checkbox.Label>
        </Checkbox.Root>
      ))}
      <Field.Root>
        <Field.Label color="fg">AI fill from brief (optional)</Field.Label>
        <Textarea
          value={aiBrief}
          onChange={(e) => setAiBrief(e.target.value)}
          size="sm"
          rows={3}
          variant="outline"
          bg="bg"
          borderColor="border"
        />
        <Button mt={2} size="sm" variant="outline" loading={aiBusy} onClick={() => void aiFill()}>
          Fill with AI
        </Button>
      </Field.Root>
      <Button colorPalette="blue" onClick={apply}>
        Create document
      </Button>
      <Button variant="ghost" onClick={props.onCancel}>
        Cancel
      </Button>
    </VStack>
  );
}
