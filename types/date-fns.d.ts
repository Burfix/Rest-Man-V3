declare module "date-fns" {
  export function addDays(date: Date | string | number, amount: number): Date;
  export function differenceInDays(
    dateLeft: Date | string | number,
    dateRight: Date | string | number,
  ): number;
  export function format(date: Date | string | number, formatStr: string): string;
  export function formatDistanceToNowStrict(
    date: Date | string | number,
    options?: { addSuffix?: boolean },
  ): string;
  export function isValid(date: unknown): boolean;
  export function parseISO(argument: string): Date;
}
