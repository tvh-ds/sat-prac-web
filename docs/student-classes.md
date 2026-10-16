# Student classes and test assignments

Admins manage named classes under Students → Classes. Students can belong to
multiple classes. Class names are unique ignoring case and outer whitespace.
Classes can be empty while being assembled; assignment requires at least one
member and supports at most 1,000 members.

Use the Assign to selector in practice-set and full-length-test dialogs to
choose a class or individual students. The server resolves and validates the
class's current student-role members and creates one ordinary assignment per
member. Duplicate student selections are removed. Practice batches retain
their existing immutable test snapshot and timer behavior.

The class ID and the name at assignment time are saved on the assignment and
its batch. Renaming a class or changing its members does not rename or change
past assignments or their recipients. Class detail shows its practice and
full-length assignment history with links to the normal batch result views.
Class badges appear in admin assignment lists/details, student management's
practice history, and student test/practice cards. Individual assignments have
no class badge. Vocabulary assignments are unchanged.

The roster and class administration APIs and database tables are admin-only.
Student test lists expose only the class label of the student's own assignment,
not other members or class administration data. Class saves use a service-only
transactional RPC to prevent an invalid roster from erasing existing members.

Practice timer inputs keep the typed string, including a temporary empty value,
until submission. Save/Assign validates whole-number minutes from 1 through 600.

## Component conventions

This feature extends the incumbent Grit system in `DESIGN.md`: navy surfaces,
champagne primary actions, Manrope headings, and Inter controls and dense data.
The conventions below are scoped to class management and assignment dialogs.

Class lists and assigned-work history use the existing table and card primitives.
Their tables retain a minimum width of 640px and scroll horizontally inside
their own card on narrow screens. Class detail follows the list, with member
links and assigned-work history; long class headings can wrap anywhere.

The class editor uses the shared modal, labeled fields, and a searchable
checkbox roster. The selected count stays visible above the roster. Select all
shown adds the filtered students to the selection; Clear selection removes
all selected students, including those hidden by the search. The roster scrolls
vertically within a 260px maximum height. Saving disables membership controls
and the save/cancel actions while the request is pending.

The shared assignment target is a labeled native select. Individual students
are the default; class options include member counts and disable empty classes.
Loading and failure messages appear next to the select. A selected class has
supporting text explaining that current members receive the assignment and later
membership changes do not alter it.

Admin class badges reuse the existing blue pill and include the explicit
`Class:` prefix. When a class ID is available, the badge links to that class in
Students; without a class name, it renders nothing. Class badges supplement
assignment titles rather than replace them. Timer fields retain a visible
minutes label and give whole-number range feedback when submitted.

## Staging verification

Migration: `20261016010000_student_classes.sql`.
Functions: `admin-classes`, `admin-tests`, `admin-practice-assignments`,
`admin-students`, `student-tests`.

`backend/worker/scripts/smoke-student-classes-staging.ts` refuses projects other
than `wgkggknyndgaoyazdhdf`. It verifies class creation, case-insensitive names,
deduplication, admin authorization/RLS, invalid-member rollback, class delivery
for both test types, membership/name snapshots, empty-class rejection, timer
bounds, student labels, and individual-assignment compatibility. Its disposable
fixtures are cleaned automatically; `--keep-for-ui` retains them temporarily and
`--cleanup` removes only the recorded fixture accounts and their owned records.
