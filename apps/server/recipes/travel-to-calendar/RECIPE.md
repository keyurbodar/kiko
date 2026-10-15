---
name: travel-to-calendar
title: Travel to calendar
description: Adds new flight and hotel confirmations from your email to your calendar, in the right time zones.
when: Daily at 18:00
tags: [travel]
apps: [Gmail, Google Calendar]
triggers:
  - name: travel to calendar
    every: FREQ=DAILY;BYHOUR=18;BYMINUTE=0
    run: find new travel confirmations and add them to the calendar. follow the travel-to-calendar skill.
agent:
  name: Itinerary
  handle: itinerary
---
each evening, find new flight and hotel confirmations and put them on the calendar.

1. search gmail for flight and hotel confirmations received since the last run. the last run time is in memory. if there is none, look back 2 days.
2. for each confirmation not already on the calendar, add one event: a flight from departure to arrival, or a hotel check-in and check-out.
3. set each time in the time zone of the place it happens. a flight starts in the departure airport's zone and ends in the arrival airport's zone. put the confirmation code in the event.
4. one bubble per event added: what it is, when, and the zone you used.
5. save the time of this run to memory.

rules
- if there are no new confirmations, reply with only [skip].
- if you cannot be sure of a time zone, add the event and say the zone is a guess.
- never add a booking twice. check the calendar for the confirmation code first.
- if gmail or google calendar is not connected, say which one and send the connect link once.
