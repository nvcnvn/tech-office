// Package tour serves the feature tour: two short, card-based orientation sequences —
// one for administrators, one for workers — selected, filtered and platform-adapted on
// the server so the rules are stated once rather than once per client.
package tour

import rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"

// Tour identifiers. These are the values stored in iam.tour_progress.tour_id and are
// CHECK-constrained there — changing one means a migration.
const (
	TourIDAdministrator = "administrator"
	TourIDWorker        = "worker"
)

// Progress statuses stored in iam.tour_progress.status, CHECK-constrained in the
// migration. "not started" has no value here: it is the absence of a row.
const (
	StatusInProgress = "in_progress"
	StatusCompleted  = "completed"
	StatusDismissed  = "dismissed"
)

// ContentVersion is the version of the copy below. It travels in the response and is
// stored on every progress write, so a person's row records which wording they saw.
// Bump it whenever the copy changes.
const ContentVersion = "2026-09-02.1"

// PermissionInviteUser is the audience discriminator. Holding it means "can bring people
// into the workspace", which is the premise of the administrator tour's first stop. It is
// granted to owner and operator and explicitly excluded from employee in the seeded role
// templates, so it separates the two audiences exactly — including for a custom role,
// which is the correct answer rather than an accident.
const PermissionInviteUser = "iam.inviteUser"

// Stop is one card in a tour.
type Stop struct {
	// Key is a stable identifier used by tests and by the clients' testIDs. It is not
	// shown to anyone.
	Key string

	Title string
	Body  string

	// ActionLabel is the button text. Empty when Target is TOUR_TARGET_NONE.
	ActionLabel string

	// Target is the surface the action opens. Each client maps it to its own route.
	Target rpcv1.TourTarget

	// RequiredPermission gates the stop. Empty means always shown. This is display
	// filtering, not authorization — the RPCs behind each surface still enforce their
	// own permissions.
	RequiredPermission string

	// WebOnly marks a capability that does not exist in the mobile app. On mobile such a
	// stop shows MobileNote instead of Body and carries no target and no action label,
	// so no client can render an action that cannot work (FR-023).
	//
	// Three administrator stops are web-only today: people, project and ritual. The mobile
	// app can list projects and rituals but has no create surface for either, so an
	// actionable "Create a project" there would open a list it cannot add to. Clearing
	// this flag is all it takes once those screens exist.
	WebOnly bool

	// MobileNote is the substitute body used when WebOnly and the caller is mobile.
	MobileNote string
}

// Tour is one complete sequence, before permission filtering.
type Tour struct {
	ID    string
	Stops []Stop
}

// administratorTour is served to anyone holding iam.inviteUser. Six stops, in the order
// FR-003 requires: get people in, make a project, define a ritual, talk about the work,
// publish the schedule, write things down.
//
// Every body is inside FR-005's 60-word cap; the ritual stop at 56 words is the one with
// no room left. The measured table in specs/039-feature-tour/contracts/tour-content.md is
// the only check on that cap — re-measure it whenever this copy changes.
var administratorTour = Tour{
	ID: TourIDAdministrator,
	Stops: []Stop{
		{
			Key:   "people",
			Title: "Everyone works here, not just the people with email",
			Body: "Your baristas, drivers and shop-floor staff do not need a company email address. " +
				"Give them an account ID and a 6-digit PIN and they sign in on their own phone. " +
				"Managers and office staff can use email and a password instead.",
			ActionLabel:        "Add your team",
			Target:             rpcv1.TourTarget_TOUR_TARGET_PEOPLE,
			RequiredPermission: PermissionInviteUser,
			WebOnly:            true,
			MobileNote: "Adding staff, importing a team and setting roles are done on the web app — " +
				"open TechOffice on a computer when you have a moment.",
		},
		{
			Key:   "project",
			Title: "A project is where work lives",
			Body: "Most small businesses need one or two, not twenty. Bright Bean Coffee runs " +
				"everything out of a single project called Store Operations. Pick the Mixed mode if " +
				"you want both one-off tasks and recurring checklists in the same place.",
			ActionLabel:        "Create a project",
			Target:             rpcv1.TourTarget_TOUR_TARGET_PROJECTS,
			RequiredPermission: "collab.createProject",
			WebOnly:            true,
			MobileNote: "Projects are set up on the web app — open TechOffice on a computer to " +
				"create your first one. You will see the work here on your phone once it exists.",
		},
		{
			Key:   "ritual",
			Title: "This is the part most businesses come here for",
			Body: "A ritual is recurring work that has to happen and has to leave proof — the " +
				"opening checklist, the closing count, the Monday deep clean. Define it once; a " +
				"fresh run appears for whoever is on shift, they submit the evidence, and you " +
				"approve it. A photo of the fridge thermometer beats someone saying they checked.",
			ActionLabel:        "Define a ritual",
			Target:             rpcv1.TourTarget_TOUR_TARGET_RITUALS,
			RequiredPermission: "collab.manageRitualDefinition",
			WebOnly:            true,
			MobileNote: "Rituals are defined on the web app. Once one is set up, the runs land " +
				"on your phone and you can approve the evidence from here.",
		},
		{
			Key:   "chat",
			Title: "Stop losing decisions in group texts",
			Body: "Channels are where the shift is discussed. When a message turns out to be a job — " +
				"the grinder is making that noise again — turn it into a task without leaving the " +
				"conversation. The task remembers which message it came from, and the message shows " +
				"where the job went.",
			ActionLabel:        "Open chat",
			Target:             rpcv1.TourTarget_TOUR_TARGET_CHAT,
			RequiredPermission: "chat.viewChannel",
		},
		{
			Key:   "schedule",
			Title: "One calendar everyone can see",
			Body: "Shifts, meetings and the room booking live in the same place. Share a booking " +
				"link and someone outside the business can pick a slot without an account.",
			ActionLabel: "Open the calendar",
			Target:      rpcv1.TourTarget_TOUR_TARGET_CALENDAR,
			// Deliberately ungated: the calendar has no view permission, only
			// calendar.manageResources for resource management. If a view permission is
			// ever added, gate this stop with it.
			RequiredPermission: "",
		},
		{
			Key:   "docs",
			Title: "So training is not a person",
			Body: "Put the procedures somewhere they can be read on a phone during a shift: how the " +
				"machine gets cleaned, what to do when the card reader dies. A ritual can point at " +
				"the document that explains why it matters.",
			ActionLabel:        "Open documents",
			Target:             rpcv1.TourTarget_TOUR_TARGET_DOCS,
			RequiredPermission: "docs.create",
		},
	},
}

// workerTour is served to everyone else. Four stops, in the order FR-004 requires.
// Shorter, plainer, and it never mentions anything the person cannot do.
var workerTour = Tour{
	ID: TourIDWorker,
	Stops: []Stop{
		{
			Key:   "today",
			Title: "Today shows what is yours",
			Body: "Anything late, anything happening today, and anything due before you go home — " +
				"in one list. If Today is empty, you are done.",
			ActionLabel:        "Show me Today",
			Target:             rpcv1.TourTarget_TOUR_TARGET_TODAY,
			RequiredPermission: "collab.viewTask",
		},
		{
			Key:   "evidence",
			Title: "Tick the box, then prove it",
			Body: "A checklist asks for evidence — a photo, a number, a note. Fill it in as you go " +
				"and submit when you are done. Your manager sees it and either approves it or asks " +
				"you to redo one part, not the whole thing.",
			ActionLabel: "Show me Today",
			// Points at Today, not at a specific checklist run: there may not be one when
			// the tour runs, and pointing at a run that does not exist is the empty-screen
			// failure the spec's edge cases forbid.
			Target:             rpcv1.TourTarget_TOUR_TARGET_TODAY,
			RequiredPermission: "collab.submitEvidence",
		},
		{
			Key:   "chat",
			Title: "Your channels are where the shift is discussed",
			Body: "Message the people you work with. If something needs doing, turn the message " +
				"into a task right there — whoever picks it up can see exactly what was said.",
			ActionLabel:        "Open chat",
			Target:             rpcv1.TourTarget_TOUR_TARGET_CHAT,
			RequiredPermission: "chat.viewChannel",
		},
		{
			Key:   "alerts",
			Title: "Alerts tell you; search finds it",
			Body: "Alerts is the bell — anything assigned to you, anything sent back for a redo. " +
				"Search finds a person, a channel, a message or a job when you know roughly what " +
				"you are looking for.",
			ActionLabel:        "Open alerts",
			Target:             rpcv1.TourTarget_TOUR_TARGET_ALERTS,
			RequiredPermission: "notif.view",
		},
	},
}

// AllTours is every defined tour. Exported for the permission-id guard in the
// integration tests, which walks it to prove no stop references a permission that does
// not exist — the ids here are bare strings with no compile-time check, so a rename in a
// later migration would otherwise flip the audience or hide a stop silently.
func AllTours() []Tour {
	return []Tour{administratorTour, workerTour}
}
