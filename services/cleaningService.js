// services/cleaningService.js
// Handles all logic for cleaning schedule calculations.

const { EPOCH_DATE } = require('../config/envConfig');
const { getPeople } = require('./peopleService');

function getTargetSundayUTC(referenceDate = new Date(), weekOffset = 0) {
    const date = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
    const dayOfWeekUTC = date.getUTCDay();
    const daysUntilUpcomingSunday = (7 - dayOfWeekUTC) % 7;
    date.setUTCDate(date.getUTCDate() + daysUntilUpcomingSunday + (weekOffset * 7));
    return date;
}

function calculateAssignmentsForCalendarWeek(peopleList, dateForTargetWeek) {
    const numPeople = peopleList.length;
    if (numPeople === 0) return { Kitchen: [], Bathroom: [], Toilet: [] };

    const targetSundayUTC = getTargetSundayUTC(new Date(dateForTargetWeek), 0);
    const weeksPassed = Math.floor((targetSundayUTC.getTime() - EPOCH_DATE.getTime()) / (7 * 24 * 60 * 60 * 1000));
    let cycleOffsetForThisWeek = weeksPassed % numPeople;
    if (cycleOffsetForThisWeek < 0) cycleOffsetForThisWeek += numPeople;
    
    // console.log(`[ASSIGN_CALC] TargetSundayUTC: ${targetSundayUTC.toISOString().split('T')[0]}, WeeksPassed: ${weeksPassed}, CycleOffset: ${cycleOffsetForThisWeek}`);

    const assignments = {};
    const rotatedPeople = [...peopleList.slice(cycleOffsetForThisWeek), ...peopleList.slice(0, cycleOffsetForThisWeek)];

    if (numPeople === 3) {
        assignments.Kitchen = [rotatedPeople[0].name];
        assignments.Bathroom = [rotatedPeople[1].name];
        assignments.Toilet = [rotatedPeople[2].name];
    } else if (numPeople === 4) {
        assignments.Kitchen = [rotatedPeople[0].name, rotatedPeople[1].name];
        assignments.Bathroom = [rotatedPeople[2].name];
        assignments.Toilet = [rotatedPeople[3].name];
    } else if (numPeople === 2) {
        assignments.Kitchen = [rotatedPeople[0].name];
        assignments.Bathroom = [rotatedPeople[1].name];
        assignments.Toilet = [rotatedPeople[0].name];
    } else if (numPeople === 1) {
        assignments.Kitchen = [rotatedPeople[0].name];
        assignments.Bathroom = [rotatedPeople[0].name];
        assignments.Toilet = [rotatedPeople[0].name];
    } else {
        assignments.Kitchen = []; assignments.Bathroom = []; assignments.Toilet = [];
    }
    return assignments;
}

async function getUpcomingCleaningSchedule(numWeeks = 4) {
  const people = await getPeople();
  const schedule = [];
  if (people.length === 0) return schedule;

  const today = new Date();
  for (let i = 0; i < numWeeks; i++) {
    const targetSundayUTC = getTargetSundayUTC(today, i);
    const assignments = calculateAssignmentsForCalendarWeek(people, targetSundayUTC);
    const displayDate = targetSundayUTC.toISOString().split('T')[0]; // YYYY-MM-DD for consistency
    schedule.push({
      date: displayDate,
      kitchen: (assignments.Kitchen || []).join(' & ') || 'N/A',
      bathroom: (assignments.Bathroom || []).join(' & ') || 'N/A',
      toilet: (assignments.Toilet || []).join(' & ') || 'N/A',
    });
  }
  return schedule;
}

module.exports = {
    getTargetSundayUTC,
    calculateAssignmentsForCalendarWeek,
    getUpcomingCleaningSchedule
};