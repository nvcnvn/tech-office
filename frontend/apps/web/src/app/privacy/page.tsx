import type { Metadata } from 'next';
import { ABUSE_CONTACT_EMAIL, PRIVACY_CONTACT_EMAIL, TERMS_VERSION } from 'apis';

import { LegalPage } from '../components/LegalPage';

export const dynamic = 'force-static';

export const metadata: Metadata = {
	title: 'Privacy policy · TechOffice',
	description:
		'What personal data TechOffice collects, why, who it is shared with, how long it is kept, and how to have it deleted.',
};

/**
 * Public privacy policy. Reachable without signing in, because both stores
 * require a policy URL anyone can open — including a reviewer who has not
 * installed the app.
 *
 * This page and docs/compliance/data-collection-inventory.md describe the same
 * collection. If a change makes them disagree, one of them is wrong, and the
 * inventory is the working document that the store privacy forms are filled in
 * from.
 */
export default function PrivacyPolicyPage() {
	return (
		<LegalPage
			title="Privacy policy"
			version={TERMS_VERSION}
			lastUpdated="27 August 2026"
			summary="TechOffice is a workplace tool. Most of what is in it belongs to the business that runs the workspace, not to us. This page says plainly what we collect, why, who else sees it, and how to get rid of it."
		>
			<h2>Who is responsible for your data</h2>
			<p>
				TechOffice is operated by Devguards. When you use a workspace that your employer created,
				your employer decides what work data goes into it and how long it is kept; we run the
				service for them. When you register a workspace yourself, you are that workspace&rsquo;s
				owner and you make those decisions.
			</p>
			<p>
				That split matters for deletion, and the section on deleting your account explains what
				follows from it.
			</p>

			<h2>What we collect</h2>
			<table>
				<thead>
					<tr>
						<th>Category</th>
						<th>Examples</th>
						<th>Why</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Account and identity</td>
						<td>Name, email address, sign-in identifier, profile picture, the workspaces you belong to and your role in each</td>
						<td>To let you sign in, to show colleagues who you are, and to decide what you may do</td>
					</tr>
					<tr>
						<td>Sign-in credentials</td>
						<td>A hashed password or PIN, or a link to a Google or Apple account you chose to sign in with</td>
						<td>To authenticate you. Passwords and PINs are stored hashed and are never readable, by us or anyone else</td>
					</tr>
					<tr>
						<td>Employment details your employer records</td>
						<td>Hire date, department, and, where the employer enters them, date of birth, phone number and home address</td>
						<td>Entered by the workspace&rsquo;s administrators as part of their own personnel records</td>
					</tr>
					<tr>
						<td>Content you create</td>
						<td>Messages, voice messages, files and photos you upload, documents, comments, tasks and calendar entries</td>
						<td>This is the work itself. It belongs to the workspace</td>
					</tr>
					<tr>
						<td>Voice calls</td>
						<td>Who called whom, when, how long, and — only when someone in the call turns recording on — the recording and its transcript</td>
						<td>To place calls, and to keep the record a workspace asked for. Calls are not recorded by default</td>
					</tr>
					<tr>
						<td>Location</td>
						<td>A single coordinate captured at the moment you check in to a scheduled event or complete a task that requires proof of presence</td>
						<td>To confirm the work happened where it was supposed to. We do not track your location between those moments and never collect it in the background</td>
					</tr>
					<tr>
						<td>Device and push</td>
						<td>A push notification token, your operating system, and a device identifier we generate</td>
						<td>To deliver notifications to the right device and to let you sign out of a specific one</td>
					</tr>
					<tr>
						<td>Presence and activity</td>
						<td>Whether you are online, when you last used the app, sign-in times, IP address and browser identifier for your sessions</td>
						<td>To show colleagues who is available, and to let you review and end your own sessions</td>
					</tr>
					<tr>
						<td>Safety records</td>
						<td>Content reports you file or that are filed about your content, including a copy of the reported content as it stood when it was reported</td>
						<td>So a report stays reviewable even after the original is deleted</td>
					</tr>
				</tbody>
			</table>

			<h2>What we do not do</h2>
			<ul>
				<li>We do not sell your personal data, and we do not share it with data brokers.</li>
				<li>We do not use your messages, files or documents to advertise to you.</li>
				<li>We do not track your location in the background or when the app is closed.</li>
				<li>We do not read your content except where we have to act on a report or a legal obligation.</li>
			</ul>

			<h2>Who else sees your data</h2>
			<p>
				Colleagues in your workspace see what you post there, according to the channels, documents
				and projects you both have access to. Your workspace&rsquo;s owners and operators can see
				member details, and can review content reports.
			</p>
			<p>We use a small number of service providers to run the product:</p>
			<table>
				<thead>
					<tr>
						<th>Provider</th>
						<th>What reaches them</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Cloudflare R2</td>
						<td>Files, photos, voice messages and call recordings you upload</td>
					</tr>
					<tr>
						<td>Google Firebase Cloud Messaging and Apple Push Notification service</td>
						<td>Push tokens and the notification text shown on your lock screen</td>
					</tr>
					<tr>
						<td>LiveKit</td>
						<td>Voice call audio while a call is in progress</td>
					</tr>
					<tr>
						<td>Amazon Simple Email Service</td>
						<td>Email address and message content for invitations and password resets</td>
					</tr>
					<tr>
						<td>Google and Apple</td>
						<td>Only if you choose to sign in with them: the identity token they issue</td>
					</tr>
				</tbody>
			</table>
			<p>
				We also disclose data where the law requires it, and where it is necessary to protect
				someone&rsquo;s safety.
			</p>

			<h2>How long we keep it</h2>
			<p>
				Workspace content is kept for as long as the workspace exists, because it is the
				business&rsquo;s own record of its work. Sessions expire and are removed. Content reports
				are kept after they are resolved, including the snapshot of the reported content, so that a
				pattern of behaviour remains visible.
			</p>

			<h2>Deleting your account</h2>
			<p>
				If you registered your own account, you can delete it from inside the app — on web under
				Settings, and on mobile under More &rsaquo; Settings. Deletion is immediate and cannot be
				undone. Before you confirm, the app tells you exactly what is erased and what is kept.
			</p>
			<p>
				<strong>What is erased:</strong> your name, email address and contact details; your date of
				birth, phone number and home address; your sign-in credentials, including any PIN or linked
				Google or Apple account; your sessions on every device; and your personal settings.
			</p>
			<p>
				<strong>What is kept:</strong> the work you did inside a workspace — messages, files,
				documents and tasks — stays with that workspace, because it is the business&rsquo;s record
				of its own work. It stops identifying you: your employee record is stripped of everything
				personal and your contributions are attributed to nobody.
			</p>
			<p>
				If your account was created for you by an employer, you cannot delete it yourself, because
				the account and its content are your employer&rsquo;s record. Instead the app lets you send
				a removal request to that workspace&rsquo;s owners, in the same place. They are notified,
				and you can see whether the request is outstanding, granted or declined. When a request is
				granted, and it was your last workspace, everything global to you is deleted as above.
			</p>

			<h2>Your choices</h2>
			<ul>
				<li>You can turn off notifications, camera, photo and location access in your device settings at any time; the rest of the app keeps working.</li>
				<li>You can review and end your active sessions.</li>
				<li>You can block another person from contacting you directly, and they are not told.</li>
				<li>You can report content you believe is abusive; the workspace&rsquo;s owners review it.</li>
			</ul>

			<h2>Children</h2>
			<p>
				TechOffice is a workplace tool and is not intended for anyone under 16. We do not knowingly
				collect data from children.
			</p>

			<h2>Contact</h2>
			<p>
				Privacy and data-protection enquiries:{' '}
				<a href={`mailto:${PRIVACY_CONTACT_EMAIL}`}>{PRIVACY_CONTACT_EMAIL}</a>.
			</p>
			<p>
				Abuse and safety reports:{' '}
				<a href={`mailto:${ABUSE_CONTACT_EMAIL}`}>{ABUSE_CONTACT_EMAIL}</a>. Reporting from inside
				the app reaches your workspace&rsquo;s owners faster; this address is for cases in-app
				reporting cannot cover.
			</p>

			<h2>Changes</h2>
			<p>
				When this policy changes materially we update the version at the top of this page and ask
				you to read and accept it again the next time you use the app.
			</p>
		</LegalPage>
	);
}
