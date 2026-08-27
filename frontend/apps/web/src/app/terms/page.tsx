import type { Metadata } from 'next';
import { ABUSE_CONTACT_EMAIL, PRIVACY_POLICY_PATH, TERMS_VERSION } from 'apis';

import { LegalPage } from '../components/LegalPage';

export const dynamic = 'force-static';

export const metadata: Metadata = {
	title: 'Terms of service · TechOffice',
	description:
		'The rules for using TechOffice, including what content is not allowed, what happens when someone posts it, and how to report abuse.',
};

/**
 * Public terms of service. Reachable without signing in.
 *
 * The "Content that is not allowed" and "What happens when someone posts it"
 * sections are not boilerplate: App Store Guideline 1.2 and Play's user-generated
 * content policy both require an app with person-to-person messaging to publish
 * terms that prohibit objectionable content, state the consequences, and give a
 * monitored contact address. A reviewer looks for exactly those three things.
 */
export default function TermsOfServicePage() {
	return (
		<LegalPage
			title="Terms of service"
			version={TERMS_VERSION}
			lastUpdated="27 August 2026"
			summary="TechOffice is a shared workspace for a business and its team. These terms say what you agree to when you use it, what is not allowed in it, and what happens if somebody breaks those rules."
		>
			<h2>Agreeing to these terms</h2>
			<p>
				You agree to these terms when you create an account, and again when they change materially.
				If you do not agree, do not use TechOffice.
			</p>
			<p>
				If an employer created your account, they have also agreed to these terms on behalf of that
				workspace, and you agree to them for your own use of it.
			</p>

			<h2>Your account</h2>
			<ul>
				<li>Keep your password or PIN to yourself. You are responsible for what happens under your account.</li>
				<li>Give accurate information, and keep it current.</li>
				<li>You must be at least 16 years old to use TechOffice.</li>
				<li>Do not share an account between people. Each person gets their own.</li>
			</ul>

			<h2>Content that is not allowed</h2>
			<p>
				TechOffice lets people message, call and share files with each other. The following are not
				allowed anywhere in it — in channels, in direct conversations, in voice calls, in documents,
				in file names, in task descriptions, or in a profile:
			</p>
			<ul>
				<li>Harassment, bullying, intimidation, or persistent unwanted contact.</li>
				<li>Hate speech, or attacks on a person or group based on race, ethnicity, national origin, religion, disability, sex, gender identity, sexual orientation, age, or any comparable characteristic.</li>
				<li>Threats of violence, incitement to violence, or celebration of it.</li>
				<li>Sexually explicit material, and any sexual content involving a minor, which we report to the authorities.</li>
				<li>Content that is unlawful, defamatory, or that infringes somebody else&rsquo;s intellectual property or privacy.</li>
				<li>Malware, phishing, spam, and bulk unsolicited messaging.</li>
				<li>Impersonating another person or misrepresenting your affiliation with an organisation.</li>
				<li>Attempts to break, overload, or gain unauthorised access to the service or to another workspace&rsquo;s data.</li>
			</ul>
			<p>
				There is no tolerance for objectionable content and no tolerance for abusive users. This is
				not a moderated public network — it is a private workplace — but the rules apply to every
				message in it.
			</p>

			<h2>What happens when someone posts it</h2>
			<p>
				Anyone can report content from the app. On a message, open its menu and choose Report; the
				same action exists on files, document comments and call records. Reporting takes at most
				three steps and asks you for a reason.
			</p>
			<p>
				A report goes to the owners and operators of the workspace it was posted in. They see the
				reported content as it stood when it was reported, so a report stays reviewable even if the
				author deletes the original. We aim to act on reports within 24 hours.
			</p>
			<p>Depending on what a review finds, any of the following may follow:</p>
			<ul>
				<li>The content is removed.</li>
				<li>The person who posted it is warned.</li>
				<li>Their account is deactivated, ending their access to the workspace immediately.</li>
				<li>Their account is terminated across TechOffice.</li>
				<li>Where the law requires it, or where someone is in danger, the matter is referred to the authorities.</li>
			</ul>
			<p>
				Separately from reporting, you can block another person, which stops them starting a direct
				conversation or a call with you. Blocking is scoped to direct contact: because this is a
				closed workplace tool, a blocked colleague&rsquo;s messages in a shared work channel stay
				visible to you, so that instructions addressed to you cannot be silently hidden. The person
				you block is not told.
			</p>

			<h2>Reporting abuse</h2>
			<p>
				Reporting from inside the app is the fastest route, because it reaches the people who can
				act on it immediately. If you cannot use the app — you have been locked out, you are not a
				member of the workspace, or the complaint is about the workspace&rsquo;s own owners — write
				to <a href={`mailto:${ABUSE_CONTACT_EMAIL}`}>{ABUSE_CONTACT_EMAIL}</a>. That mailbox is
				monitored.
			</p>

			<h2>Who owns what</h2>
			<p>
				You keep ownership of the content you create. By putting it in a workspace you allow us to
				store, process and display it so the service can work, and you allow the workspace and its
				members to see and use it as part of their work.
			</p>
			<p>
				Content created inside a workspace belongs to the business that runs it, not to the
				individual who typed it. That is why deleting your account removes what identifies you but
				leaves the workspace&rsquo;s record of its own work intact — see the{' '}
				<a href={PRIVACY_POLICY_PATH}>privacy policy</a> for exactly what is erased and what is
				kept.
			</p>

			<h2>Ending your account</h2>
			<p>
				You can delete an account you created yourself at any time, from inside the app. If an
				employer created your account, you can send a removal request to that workspace&rsquo;s
				owners from inside the app, and they decide.
			</p>
			<p>
				We may suspend or terminate an account that breaks these terms, and we will say why unless
				doing so would put someone at risk.
			</p>

			<h2>Service availability</h2>
			<p>
				TechOffice is provided as it is. We work to keep it available and correct, but we do not
				promise it will be uninterrupted or error-free, and we are not liable for indirect or
				consequential loss. Nothing here limits liability that cannot be limited by law.
			</p>

			<h2>Changes to these terms</h2>
			<p>
				When these terms change materially we update the version at the top of this page and ask
				you to read and accept them again the next time you use the app. Continuing to use
				TechOffice after that means you accept the new version.
			</p>

			<h2>Contact</h2>
			<p>
				Abuse and safety: <a href={`mailto:${ABUSE_CONTACT_EMAIL}`}>{ABUSE_CONTACT_EMAIL}</a>.
			</p>
			<p>
				Privacy: see the <a href={PRIVACY_POLICY_PATH}>privacy policy</a>.
			</p>
		</LegalPage>
	);
}
