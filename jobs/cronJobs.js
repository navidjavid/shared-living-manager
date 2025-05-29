// jobs/cronJobs.js
// Defines and schedules cron jobs for notifications.

const cron = require('node-cron');
const bot = require('../bot/botInstance'); // Get the bot instance
const { getPeople } = require('../services/peopleService');
const { getTargetSundayUTC, calculateAssignmentsForCalendarWeek } = require('../services/cleaningService');
const { CRON_TIMEZONE } = require('../config/envConfig');

// Helper to format UTC dates for bot messages, adjust locale and options as needed
const formatLocaleDateFromUTCDate = (utcDate) => {
    // Ensure utcDate is a Date object
    const dateToFormat = (typeof utcDate === 'string' || typeof utcDate === 'number') ? new Date(utcDate) : utcDate;
    if (isNaN(dateToFormat.getTime())) {
        return 'Invalid Date';
    }
    return dateToFormat.toLocaleDateString('en-GB', { // Use 'de-DE' or your preferred locale
        day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' // Format as UTC date
    });
};

/**
 * Calculates and sends weekly cleaning assignments.
 * Runs every Sunday at the scheduled time.
 * @param {boolean} forceSend - If true, sends a message even if no specific tasks.
 */
async function sendCleaningAssignments(forceSend = false) {
  console.log('[CRON_JOB] Running sendCleaningAssignments job...');
  try {
    const people = await getPeople();
    if (people.length === 0) {
      console.log('[CRON_JOB] No people registered for assignments. Skipping.');
      return;
    }

    // This cron runs on Sunday. Tasks are for the week starting THIS Sunday.
    const thisSundayUTC = getTargetSundayUTC(new Date(), 0); // Gets today (Sunday) normalized to UTC start of day
    const assignmentsForThisWeek = calculateAssignmentsForCalendarWeek(people, thisSundayUTC);
    
    const wednesdayOfThisWeekUTC = new Date(thisSundayUTC);
    wednesdayOfThisWeekUTC.setUTCDate(thisSundayUTC.getUTCDate() + 3); // Wednesday is 3 days after Sunday

    let messagesSent = 0;
    for (const person of people) {
      if (!person.chat_id) {
        console.log(`[CRON_JOB] Skipping notification for ${person.name}, no chat_id found.`);
        continue;
      }

      let personTasks = [];
      for (const task in assignmentsForThisWeek) {
        if (assignmentsForThisWeek[task] && assignmentsForThisWeek[task].includes(person.name)) {
          personTasks.push(task);
        }
      }

      if (personTasks.length > 0 || forceSend) {
        let message = `Hi ${person.name}! Your cleaning tasks for the week starting Sunday, ${formatLocaleDateFromUTCDate(thisSundayUTC)}:\n`;
        if (personTasks.length === 0 && forceSend) {
          message = `Hi ${person.name}, this is your weekly cleaning schedule ping! No specific major tasks assigned to you this week.`;
        } else {
          personTasks.forEach(task => {
              message += `- ${task} (Mainly on ${formatLocaleDateFromUTCDate(thisSundayUTC)})\n`;
              if (task === 'Toilet') {
                  message += `  (Remember, also on Wednesday, ${formatLocaleDateFromUTCDate(wednesdayOfThisWeekUTC)})\n`;
              }
          });
        }
        
        try {
          await bot.telegram.sendMessage(person.chat_id, message);
          messagesSent++;
          console.log(`[CRON_JOB] Successfully sent weekly task notification to ${person.name}`);
        } catch (error) {
          console.error(`[CRON_JOB] ❌ Failed to send weekly task to ${person.name} (Chat ID: ${person.chat_id}, Telegram User ID: ${person.telegram_user_id})`);
          console.error(`[CRON_JOB] Error Message: ${error.message}`);
          if (error.response && error.response.description) {
              console.error(`[CRON_JOB] Telegram API Error Description: ${error.response.description}`);
          }
          if (error.code === 403) { // Bot blocked or chat inaccessible
              console.warn(`[CRON_JOB] Received 403 error for ${person.name}. Clearing their chat_id.`);
              if (person.telegram_user_id) {
                  try {
                      // query function needs to be accessible here or imported from db.js
                      const { query } = require('../config/db'); 
                      await query('UPDATE people SET chat_id = NULL WHERE telegram_user_id = $1', [person.telegram_user_id]);
                      console.log(`[CRON_JOB] Cleared chat_id for ${person.name} due to 403 error.`);
                  } catch (dbError) {
                      console.error(`[CRON_JOB] Failed to clear chat_id for ${person.name} after 403 error:`, dbError);
                  }
              }
          }
        }
      }
    }
    console.log(`[CRON_JOB] Sent ${messagesSent} weekly assignment messages. Rotation is calendar-based.`);
    // No offset update needed in the database with the calendar-based logic.
  } catch (error) {
      console.error('❌❌❌ [CRON_JOB] Unhandled error in sendCleaningAssignments:', error);
  }
}

/**
 * Sends reminders for Wednesday toilet cleaning.
 * Runs every Wednesday at the scheduled time.
 */
async function sendWednesdayToiletReminders() {
  console.log('[CRON_JOB] Running sendWednesdayToiletReminders job...');
  try {
    const people = await getPeople();
    if (people.length === 0) {
      console.log('[CRON_JOB] No people registered. Skipping Wednesday reminders.');
      return;
    }

    const todayIsWednesdayUTC = new Date(); // This cron runs on Wednesday
    // Ensure we are using the start of the day UTC for consistent date for calculateAssignmentsForCalendarWeek
    const normalizedTodayUTC = new Date(Date.UTC(todayIsWednesdayUTC.getUTCFullYear(), todayIsWednesdayUTC.getUTCMonth(), todayIsWednesdayUTC.getUTCDate()));


    const assignmentsForCurrentWeek = calculateAssignmentsForCalendarWeek(people, normalizedTodayUTC);

    if (assignmentsForCurrentWeek.Toilet && assignmentsForCurrentWeek.Toilet.length > 0) {
      assignmentsForCurrentWeek.Toilet.forEach(async (personName) => {
        const personToNotify = people.find(p => p.name === personName && p.chat_id);
        if (personToNotify) {
          const message = `🧹 Reminder: Today, ${formatLocaleDateFromUTCDate(normalizedTodayUTC)}, is your mid-week toilet cleaning day!`;
          try {
            await bot.telegram.sendMessage(personToNotify.chat_id, message);
            console.log(`[CRON_JOB] Sent Wednesday toilet reminder to ${personName}.`);
          } catch (error) {
            console.error(`[CRON_JOB] ❌ Failed to send Wednesday reminder to ${personName} (Chat ID: ${personToNotify.chat_id}, Telegram User ID: ${personToNotify.telegram_user_id})`);
            console.error(`[CRON_JOB] Error Message: ${error.message}`);
            if (error.response && error.response.description) {
                console.error(`[CRON_JOB] Telegram API Error Description: ${error.response.description}`);
            }
            if (error.code === 403) {
                console.warn(`[CRON_JOB] Received 403 error for ${personToNotify.name} on Wednesday reminder. Clearing chat_id.`);
                if (personToNotify.telegram_user_id) {
                    try {
                        const { query } = require('../config/db');
                        await query('UPDATE people SET chat_id = NULL WHERE telegram_user_id = $1', [personToNotify.telegram_user_id]);
                        console.log(`[CRON_JOB] Cleared chat_id for ${personToNotify.name} due to 403 error on Wednesday reminder.`);
                    } catch (dbError) {
                        console.error(`[CRON_JOB] Failed to clear chat_id for ${personToNotify.name} after 403 error:`, dbError);
                    }
                }
            }
          }
        } else {
          // This might happen if a person assigned to Toilet was removed or their chat_id became null
          // between the start of the week and Wednesday.
          console.warn(`[CRON_JOB] Could not find person object or chat_id for ${personName} assigned to Toilet for Wednesday reminder.`);
        }
      });
    } else {
      console.log('[CRON_JOB] No one assigned to Toilet this week for Wednesday reminder based on calendar calculation.');
    }
  } catch (error) {
    console.error('❌❌❌ [CRON_JOB] Unhandled error in sendWednesdayToiletReminders:', error);
  }
}

/**
 * Initializes and starts all cron jobs.
 */
function startCronJobs() {
    // Schedule to run every Sunday at 10 PM (22:00) in the specified CRON_TIMEZONE
    cron.schedule('0 10 * * 0', () => {
        console.log(`[CRON_TRIGGER] Sunday 10 PM task triggered at ${new Date().toLocaleString()}.`);
        sendCleaningAssignments();
    }, { timezone: CRON_TIMEZONE });

    // Schedule to run every Wednesday at 10 AM (10:00) in the specified CRON_TIMEZONE
    cron.schedule('0 10 * * 3', () => {
        console.log(`[CRON_TRIGGER] Wednesday 10 AM task triggered at ${new Date().toLocaleString()}.`);
        sendWednesdayToiletReminders();
    }, { timezone: CRON_TIMEZONE });

    console.log(`[CRON_SETUP] Cron jobs for weekly assignments and Wednesday reminders scheduled in timezone: ${CRON_TIMEZONE}.`);
}

module.exports = { startCronJobs };