// deno-lint-ignore-file no-explicit-any
import { Octokit } from "npm:@octokit/rest@19.0.7";
import { graphql } from "npm:@octokit/graphql@5.0.5";
import figlet from "npm:figlet@1.6.0";
import axiod from "https://deno.land/x/axiod@0.26.2/mod.ts";
import { DateTime } from "npm:luxon@3.3.0";

interface GithubStats {
  total_commits: number;
  total_prs: number;
  total_issues: number;
  total_stars: number;
  repos_owned: number;
  contributed_to: number;
}

interface LanguageStats {
  [key: string]: number;
}

interface RepoLanguages {
  [key: string]: number;
}

class GitHubProfileGenerator {
  private octokit: Octokit;
  private graphqlWithAuth: typeof graphql;
  private customAsciiArt: string = `888'Y88                               ,8,"88e  ,8,"88b, 8888888  ,d8 8b,  
888 ,'Y 888 888 8e   e88 88e  888 8e   "  888D  " ,88P' 88       "Y8 8P"  
888C8   888 888 88b d888 888b 888 88b     88P     C8K   """Y88b  ,d8 8b,  
888 ",d 888 888 888 Y888 888P 888 888    ,*"    e \`88b,  e  888 C888 888D 
888,d88 888 888 888  "88 88"  888 888  8888888 "8",88P' "8",88P  "Y8 8P"  
`;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
    this.graphqlWithAuth = graphql.defaults({
      headers: {
        authorization: `token ${token}`,
      },
    });
  }

  private async downloadFont(): Promise<void> {
    const fontUrl =
      "https://raw.githubusercontent.com/thugcrowd/gangshit/master/gangshit2.flf";
    const response = await axiod.get(fontUrl, { responseType: "arraybuffer" });
    await Deno.writeFile("gangshit1.flf", new Uint8Array(response.data));
  }

  private async getGithubActivity(username: string): Promise<any[]> {
    const { data } = await this.octokit.activity.listPublicEventsForUser({
      username,
      per_page: 5,
    });
    return data;
  }

  private async getAllLanguages(username: string): Promise<[string, number][]> {
    const { data: repos } = await this.octokit.repos.listForUser({
      username,
      per_page: 100,
    });

    const languages: LanguageStats = {};
    let totalBytes = 0;

    for (const repo of repos) {
      const { data: repoLanguages } = await this.octokit.repos.listLanguages({
        owner: username,
        repo: repo.name,
      });

      for (const [lang, bytes] of Object.entries(
        repoLanguages as RepoLanguages
      )) {
        languages[lang] = (languages[lang] || 0) + bytes;
        totalBytes += bytes;
      }
    }

    return Object.entries(languages)
      .map(
        ([lang, bytes]) =>
          [lang, (bytes / totalBytes) * 100] as [string, number]
      )
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);
  }

  private createAsciiBar(percentage: number, width: number): string {
    const filledWidth = Math.round((percentage / 100) * width);
    const bar = Array(width)
      .fill("")
      .map((_, i) => {
        if (i < filledWidth) return "█";
        if (i === filledWidth) return "▓";
        return "░";
      })
      .join("");
    return `[${bar}]`;
  }

  private formatActivity(activity: any): string {
    const eventType = activity.type.replace("Event", "");
    const repo = activity.repo.name;
    const createdAt = DateTime.fromISO(activity.created_at).toFormat(
      "yyyy-MM-dd HH:mm"
    );
    return `${createdAt.padEnd(16)} | ${eventType.padEnd(15)} | ${repo}`;
  }

  private async getGithubStats(username: string): Promise<GithubStats> {
    const query = `
      query($username: String!) {
        user(login: $username) {
          contributionsCollection {
            totalCommitContributions
            totalPullRequestContributions
            totalIssueContributions
            restrictedContributionsCount
          }
          repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
            totalCount
            nodes {
              stargazerCount
            }
          }
          repositoriesContributedTo(first: 1, contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]) {
            totalCount
          }
        }
      }
    `;

    const data: any = await this.graphqlWithAuth(query, { username });
    const user = data.user;
    const contributions = user.contributionsCollection;
    const repositories = user.repositories;

    const totalStars = repositories.nodes.reduce(
      (sum: number, repo: any) => sum + repo.stargazerCount,
      0
    );

    return {
      total_commits:
        contributions.totalCommitContributions +
        contributions.restrictedContributionsCount,
      total_prs: contributions.totalPullRequestContributions,
      total_issues: contributions.totalIssueContributions,
      total_stars: totalStars,
      repos_owned: repositories.totalCount,
      contributed_to: user.repositoriesContributedTo.totalCount,
    };
  }

  private formatGithubStats(stats: GithubStats): string {
    return `+-------------+------------------------+----------------+--------------------------------------+
|   Metric    |         Value          |     Metric     |                Value                 |
+-------------+------------------------+----------------+--------------------------------------+
|   Commits   | ${stats.total_commits
      .toString()
      .padStart(22)} | Issues opened  | ${stats.total_issues
      .toString()
      .padStart(36)} |
| PRs opened  | ${stats.total_prs
      .toString()
      .padStart(22)} | Stars received | ${stats.total_stars
      .toString()
      .padStart(36)} |
| Repos owned | ${stats.repos_owned
      .toString()
      .padStart(22)} | Contributed to | ${stats.contributed_to
      .toString()
      .padStart(36)} |
+-------------+------------------------+----------------+--------------------------------------+`;
  }

  private createAsciiBadge(
    label: string,
    value: string,
    width: number
  ): string {
    const totalWidth = Math.max(width, label.length + value.length + 4);
    const labelWidth = label.length + 2;
    const valueWidth = totalWidth - labelWidth;

    const topBottom = "─".repeat(totalWidth);
    const labelPart = ` ${label.padEnd(labelWidth - 2)}`;
    const valuePart = ` ${value.padEnd(valueWidth - 2)} `;

    return `╭${topBottom}╮
│${labelPart}│${valuePart}│
╰${topBottom}╯`;
  }

  private async getGithubFollowers(username: string): Promise<number> {
    const { data: user } = await this.octokit.users.getByUsername({ username });
    return user.followers;
  }

  public async generateProfile(username: string): Promise<void> {
    await this.downloadFont();

    const [activities, topLanguages, githubStats, githubFollowers] =
      await Promise.all([
        this.getGithubActivity(username),
        this.getAllLanguages(username),
        this.getGithubStats(username),
        this.getGithubFollowers(username),
      ]);

    const githubFollowersBadge = this.createAsciiBadge(
      "Followers",
      githubFollowers.toString(),
      20
    );
    const githubStarsBadge = this.createAsciiBadge(
      "Stars",
      githubStats.total_stars.toString(),
      20
    );

    let output = "> [!WARNING]\n> ```\n";

    // Combine header and badges
    const headerLines = this.customAsciiArt.split("\n");
    const badgesString = `${githubFollowersBadge}\n\n${githubStarsBadge}`;
    const badgeLines = badgesString.split("\n");
    const maxHeaderWidth = Math.max(
      ...headerLines.map((line: string) => line.length)
    );
    const badgeOffset = 4;

    for (
      let i = 0;
      i < Math.max(headerLines.length, badgeLines.length + badgeOffset);
      i++
    ) {
      const headerPart = headerLines[i] || "";
      const badgePart =
        i >= badgeOffset ? badgeLines[i - badgeOffset] || "" : "";
      output += `> ${headerPart.padEnd(maxHeaderWidth + 2)}${badgePart}\n`;
    }

    output += "> ```\n";
    output +=
      "> <p>Software by this user may be <b>potentially hazardous</b>. Explore at your own risk.</p>\n\n";
    output += "---\n\n";

    // Languages section
    output += "#### 🛠️ Languages\n```css\n";
    for (const [lang, percentage] of topLanguages) {
      output += `${lang.padEnd(12)} ${this.createAsciiBar(
        percentage,
        20
      )} ${percentage.toFixed(1)}%\n`;
    }
    output += "```\n\n";

    // Stats section
    output += "#### 📊 Stats\n```\n";
    output += this.formatGithubStats(githubStats);
    output += "\n```\n\n";

    // Activity section
    output += "#### 🔥 Activity\n```\n";
    output += "-".repeat(60) + "\n";
    activities.slice(0, 5).forEach((activity) => {
      output += this.formatActivity(activity) + "\n";
    });
    output += "-".repeat(60) + "\n\n";

    const now = DateTime.now().toFormat("yyyy-MM-dd HH:mm:ss");
    output += `Last updated: ${now}\n`;
    output += "```\n\n";

    output += "> [!NOTE]\n";
    output +=
      '> <p align="center">This README is <b>auto-generated</b> with Deno and Actions</p>';

    await Deno.writeTextFile("README.md", output);
    console.log("✅ README.md has been updated successfully.");
  }
}

if (import.meta.main) {
  try {
    const token = Deno.env.get("GITHUB_TOKEN");
    if (!token) {
      throw new Error("GITHUB_TOKEN not set");
    }

    const generator = new GitHubProfileGenerator(token);
    await generator.generateProfile("emon2358");
  } catch (error) {
    console.error("Error:", error);
    Deno.exit(1);
  }
}
