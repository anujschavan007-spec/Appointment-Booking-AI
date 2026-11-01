// Normalizes Hinglish date and time expressions into ISO/IST date and 24h time
// Timezone: Asia/Kolkata

export interface NormalizedDateTime {
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM 24h e.g. "10:30"
  displayTime?: string; // e.g. "10:30 AM"
  weekday: number; // 0=Sun, 1=Mon, ..., 6=Sat
  originalPhrase: string;
}

export class HinglishDateNormalizer {
  // Current reference date in Asia/Kolkata (IST: UTC + 5:30)
  public static getNowIST(): Date {
    const now = new Date();
    // Offset for IST (UTC + 5:30 = 330 minutes)
    const istOffsetMs = 330 * 60 * 1000;
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
    return new Date(utcMs + istOffsetMs);
  }

  public static formatDateISO(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  public static parse(phrase: string, referenceDate?: Date): NormalizedDateTime {
    const text = phrase.toLowerCase().trim();
    const ref = referenceDate ? new Date(referenceDate) : this.getNowIST();
    const targetDate = new Date(ref);
    let hasDate = false;

    // 1. Detect Day Offset
    if (text.includes('parso') || text.includes('परसों') || text.includes('day after tomorrow')) {
      targetDate.setDate(targetDate.getDate() + 2);
      hasDate = true;
    } else if (text.includes('kal') || text.includes('कल') || text.includes('tomorrow')) {
      targetDate.setDate(targetDate.getDate() + 1);
      hasDate = true;
    } else if (text.includes('aaj') || text.includes('आज') || text.includes('today')) {
      hasDate = true;
    } else {
      // Check for specific days (somwar, mangalwar, etc.)
      const daysMap: Record<string, number> = {
        sunday: 0,
        itwar: 0,
        ravivar: 0,
        रविवार: 0,
        monday: 1,
        somwar: 1,
        सोमवार: 1,
        tuesday: 2,
        mangalwar: 2,
        मंगलवार: 2,
        wednesday: 3,
        budhwar: 3,
        बुधवार: 3,
        thursday: 4,
        guruwar: 4,
        guruvaar: 4,
        गुरुवार: 4,
        friday: 5,
        shukrawar: 5,
        शुक्रवार: 5,
        saturday: 6,
        shaniwar: 6,
        शनिवार: 6,
      };

      for (const [dayName, dayIndex] of Object.entries(daysMap)) {
        if (text.includes(dayName)) {
          const currentDay = ref.getDay();
          let diff = dayIndex - currentDay;
          if (diff <= 0) diff += 7; // next week's day
          targetDate.setDate(targetDate.getDate() + diff);
          hasDate = true;
          break;
        }
      }
    }

    // Check for explicit ISO date: YYYY-MM-DD
    const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (isoMatch) {
      const parsedIso = new Date(isoMatch[1]);
      if (!isNaN(parsedIso.getTime())) {
        targetDate.setTime(parsedIso.getTime());
        hasDate = true;
      }
    }

    const isoDateStr = hasDate ? this.formatDateISO(targetDate) : undefined;
    const weekday = targetDate.getDay();

    // 2. Detect Time
    let parsedTime: string | undefined;
    let displayTime: string | undefined;

    // e.g. "10:30 AM", "04:30 PM", "11 AM", "2:00 PM"
    const standardTimeMatch = text.match(/\b([0-1]?[0-9]|2[0-3])(?::([0-5][0-9]))?\s*(am|pm)\b/i);
    // e.g. "subah 10 baje", "shaam 4 baje", "dopahar 2 baje"
    const hinglishTimeMatch = text.match(/(?:subah|dopahar|shaam|raat)?\s*([0-1]?[0-9]|2[0-3])(?::([0-5][0-9]))?\s*(?:baje|बजे)/i);

    if (standardTimeMatch) {
      let hours = parseInt(standardTimeMatch[1], 10);
      const minutes = standardTimeMatch[2] ? standardTimeMatch[2] : '00';
      const meridian = standardTimeMatch[3].toUpperCase();

      if (meridian === 'PM' && hours < 12) hours += 12;
      if (meridian === 'AM' && hours === 12) hours = 0;

      parsedTime = `${String(hours).padStart(2, '0')}:${minutes}`;
      displayTime = `${standardTimeMatch[1]}:${minutes} ${meridian}`;
    } else if (hinglishTimeMatch) {
      let hours = parseInt(hinglishTimeMatch[1], 10);
      const minutes = hinglishTimeMatch[2] ? hinglishTimeMatch[2] : '00';

      const isEvening = text.includes('shaam') || text.includes('raat') || text.includes('dopahar');
      if (isEvening && hours < 12) hours += 12;

      parsedTime = `${String(hours).padStart(2, '0')}:${minutes}`;
      const displayHours = hours % 12 || 12;
      const meridian = hours >= 12 ? 'PM' : 'AM';
      displayTime = `${displayHours}:${minutes} ${meridian}`;
    }

    return {
      date: isoDateStr,
      time: parsedTime,
      displayTime,
      weekday,
      originalPhrase: phrase,
    };
  }
}

